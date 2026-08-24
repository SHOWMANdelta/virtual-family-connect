/**
 * Auth entry point.
 *
 * Three sign-in methods are supported:
 *   - "google"    Google OAuth. Needs AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET on the
 *                 deployment; see README "Authentication setup".
 *   - "email-otp" 6-digit code emailed to the address (see ./auth/emailOtp).
 *   - "anonymous" One-tap guest access, no credentials required.
 *
 * Every provider additionally requires JWT_PRIVATE_KEY, JWKS and SITE_URL to be
 * set on the deployment. Run `pnpm setup:auth` to generate and install them.
 */

import Google from "@auth/core/providers/google";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth } from "@convex-dev/auth/server";
import { emailOtp } from "./auth/emailOtp";

/**
 * Only allow post-sign-in redirects that stay inside this app: either a
 * root-relative path, or an absolute URL on our own origin. Without this an
 * attacker could craft a sign-in link that bounces the user to another site
 * after they authenticate.
 */
function safeRedirect(redirectTo: string): string {
  const siteUrl = process.env.SITE_URL;

  // Root-relative path, e.g. "/join/abc123". Reject "//evil.com" (protocol-relative).
  if (redirectTo.startsWith("/") && !redirectTo.startsWith("//")) {
    return redirectTo;
  }

  if (siteUrl) {
    try {
      if (new URL(redirectTo).origin === new URL(siteUrl).origin) {
        return redirectTo;
      }
    } catch {
      // Not a parseable URL — fall through to the default below.
    }
  }

  return siteUrl ?? "/";
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google, emailOtp, Anonymous],

  callbacks: {
    async redirect({ redirectTo }) {
      return safeRedirect(redirectTo);
    },

    /**
     * Runs after the default user record has been created or updated.
     *
     * Normalises the email to lower case so that looking a user up by address
     * (room invites, connection requests) matches regardless of how they typed
     * it, and gives brand new accounts a default role.
     */
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      const user = await ctx.db.get(userId);
      if (!user) return;

      const patch: {
        email?: string;
        name?: string;
        role?: "user";
        isOnline?: boolean;
        lastSeen?: number;
      } = {};

      if (user.email && user.email !== user.email.toLowerCase()) {
        patch.email = user.email.toLowerCase();
      }

      // Guest accounts carry neither a name nor an email, which would leave the
      // participant list and header rendering a blank label. Give them one.
      if (!user.name && !user.email) {
        patch.name = "Guest";
      }

      // Only stamp a role on first creation; never overwrite an assigned one.
      if (existingUserId === null && user.role === undefined) {
        patch.role = "user";
      }

      patch.isOnline = true;
      patch.lastSeen = Date.now();

      await ctx.db.patch(userId, patch);
    },
  },
});
