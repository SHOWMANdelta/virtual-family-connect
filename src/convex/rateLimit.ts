/**
 * Fixed-window rate limiting for the endpoints that spend money or sending
 * reputation.
 *
 * Why this exists: `auth.signIn` is a public, unauthenticated endpoint, and
 * every call to it with an `email` sends a real email. The 45-second cooldown on
 * the login page is React state — a loop hitting the Convex endpoint directly
 * ignores it completely. Without a server-side limit, anyone can
 *   - mail-bomb a third party from our verified sending domain, which gets the
 *     domain blocklisted and takes email down for every real user, and
 *   - exhaust the provider's daily quota, which is a total sign-in outage.
 *
 * A fixed window (rather than a token bucket or sliding log) is deliberate: it
 * needs one document and one read per check, and the burst it permits at a
 * window boundary — at most 2x the limit — is irrelevant at these thresholds.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

const MINUTE = 60 * 1000;

/** One bucket's policy. */
type Limit = {
  /** Requests permitted per window. */
  max: number;
  /** Window length in ms. */
  windowMs: number;
};

/**
 * Sign-in codes, per email address. Three attempts per quarter hour is enough
 * for a genuine user who mistyped their address once and needed a resend, and
 * far too few to be useful as a mail bomb.
 */
const OTP_PER_ADDRESS: Limit = { max: 3, windowMs: 15 * MINUTE };

/**
 * Sign-in codes, deployment-wide. Stops address enumeration from sidestepping
 * the per-address limit by rotating recipients, and keeps a burst well inside a
 * free-tier daily quota (Resend's is 100/day).
 */
const OTP_GLOBAL: Limit = { max: 20, windowMs: 10 * MINUTE };

/** Room invitations, per inviting user. Authenticated, so this is looser. */
const INVITE_PER_USER: Limit = { max: 20, windowMs: 60 * MINUTE };

/**
 * The longest window any bucket uses. Derived rather than written down, so
 * adding a limit above can't silently invalidate the cleanup cron below.
 */
const LONGEST_WINDOW_MS = Math.max(
  OTP_PER_ADDRESS.windowMs,
  OTP_GLOBAL.windowMs,
  INVITE_PER_USER.windowMs,
);

/** Rows removed per cleanup run, to keep each one a small transaction. */
const CLEANUP_BATCH = 200;

export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Consume one unit from a bucket.
 *
 * Rejection reports how long the caller must wait, so the error message can be
 * specific instead of a vague "try again later".
 */
async function consume(
  ctx: MutationCtx,
  key: string,
  limit: Limit,
): Promise<RateLimitVerdict> {
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  // No bucket yet, or the previous window has fully elapsed: start a fresh one.
  if (!existing || now - existing.windowStartedAt >= limit.windowMs) {
    if (existing) {
      await ctx.db.patch(existing._id, { windowStartedAt: now, count: 1 });
    } else {
      await ctx.db.insert("rateLimits", {
        key,
        windowStartedAt: now,
        count: 1,
      });
    }
    return { allowed: true };
  }

  if (existing.count >= limit.max) {
    const msRemaining = existing.windowStartedAt + limit.windowMs - now;
    return {
      allowed: false,
      // Round up: reporting 0 seconds when 400ms remain invites an instant retry.
      retryAfterSeconds: Math.max(1, Math.ceil(msRemaining / 1000)),
    };
  }

  await ctx.db.patch(existing._id, { count: existing.count + 1 });
  return { allowed: true };
}

function describeWait(seconds: number): string {
  if (seconds < 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Guard a sign-in code request. Checks the per-address bucket first so that one
 * hammered address can't consume the global allowance and lock out everyone
 * else.
 *
 * Throws with a structured `CODE: message` prefix, which the client's error
 * parser turns into the sentence shown to the user.
 */
export const consumeOtpSend = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();

    const perAddress = await consume(ctx, `otp:${email}`, OTP_PER_ADDRESS);
    if (!perAddress.allowed) {
      // The warning about the earlier code matters: Convex Auth creates (and
      // overwrites) the verification code *before* calling us, so a request we
      // reject has already invalidated whatever the user is holding. Saying only
      // "try again later" would leave them typing a code that can't work and
      // reading the resulting "invalid code" as a second, unrelated bug.
      throw new Error(
        `OTP_RATE_LIMITED: Too many sign-in codes requested for this address. Any code you already received has stopped working — request a fresh one in ${describeWait(perAddress.retryAfterSeconds)}.`,
      );
    }

    const global = await consume(ctx, "otp:__all__", OTP_GLOBAL);
    if (!global.allowed) {
      // Deliberately vaguer: the caller isn't personally at fault, and the exact
      // deployment-wide threshold isn't something to advertise.
      throw new Error(
        `OTP_RATE_LIMITED: Sign-in codes are temporarily throttled on this server. Try again in ${describeWait(global.retryAfterSeconds)}.`,
      );
    }
  },
});

/**
 * Guard a room invitation. Keyed by the inviting user rather than the recipient:
 * the recipient is the one being protected, and re-inviting the same address
 * repeatedly is the abuse shape here.
 *
 * A plain helper rather than a mutation, because every caller already holds a
 * mutation ctx — going through `ctx.runMutation` would buy nothing.
 */
export async function enforceInviteLimit(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const verdict = await consume(ctx, `invite:${userId}`, INVITE_PER_USER);
  if (!verdict.allowed) {
    throw new Error(
      `INVITE_RATE_LIMITED: You've sent a lot of invitations recently. Try again in ${describeWait(verdict.retryAfterSeconds)}.`,
    );
  }
}

/**
 * Drop buckets whose window has fully elapsed. Run from crons.ts.
 *
 * Needed because the per-address key is chosen by whoever calls the public
 * sign-in endpoint: every distinct address anyone ever submits leaves a row, and
 * nothing above ever deletes one. The global limit caps the bleed at a few
 * thousand rows a day rather than making it a denial-of-service, but it is still
 * unbounded growth driven by anonymous input.
 *
 * Deleting an elapsed bucket is behaviourally invisible: `consume` treats a
 * missing bucket and an expired one identically, both starting a fresh window.
 * The cutoff is the longest window plus a margin, so a bucket still inside its
 * window is never in scope.
 */
export const deleteElapsedWindows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - LONGEST_WINDOW_MS - MINUTE;

    // Ascending on the window index, so the oldest go first and the scan can
    // stop at the first row still in scope rather than reading the whole table.
    const stale = await ctx.db
      .query("rateLimits")
      .withIndex("by_window", (q) => q.lt("windowStartedAt", cutoff))
      .order("asc")
      .take(CLEANUP_BATCH);

    for (const row of stale) {
      await ctx.db.delete(row._id);
    }

    // Reported so a backlog is visible in the logs: a run that deletes exactly
    // CLEANUP_BATCH rows means there were more waiting.
    return { deleted: stale.length, cutoff };
  },
});
