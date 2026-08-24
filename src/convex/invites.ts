import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { throwErr } from "./errors";
import { enforceInviteLimit } from "./rateLimit";
import { addParticipantToRoom, assertRoomJoinable } from "./rooms";
import { getCurrentUser } from "./users";

const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TOKEN_BYTES = 24; // 192 bits of entropy

/** Random url-safe token used as the secret in the emailed join link. */
function generateInviteToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Where the join link should point.
 *
 * SITE_URL always wins. A client-supplied origin is only honoured when it is a
 * loopback address (local development) or already matches SITE_URL — otherwise a
 * caller could get us to email an arbitrary link on our own letterhead.
 */
function resolveAppOrigin(clientOrigin: string | undefined): string {
  const siteUrl = process.env.SITE_URL;

  if (siteUrl) {
    try {
      return new URL(siteUrl).origin;
    } catch {
      // Malformed SITE_URL — fall through to the client value.
    }
  }

  if (clientOrigin) {
    try {
      const parsed = new URL(clientOrigin);
      const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
      const isLoopback =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]";
      if (isHttp && isLoopback) {
        return parsed.origin;
      }
    } catch {
      // Not a URL — ignore it.
    }
  }

  return "http://localhost:5173";
}

function displayName(user: Doc<"users"> | null): string {
  return user?.name ?? user?.email ?? "Someone";
}

/** Human label for a duration, e.g. "25 minutes" / "24 hours". */
function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Invite somebody to a room by email address.
 *
 * Unlike the previous implementation this works whether or not the address
 * belongs to an existing account — that is the whole point of emailing a link.
 * Registered users additionally get the in-app notification they got before.
 */
export const sendRoomInvite = mutation({
  args: {
    roomId: v.id("rooms"),
    email: v.string(),
    note: v.optional(v.string()),
    /** window.location.origin, used only as a dev fallback for the link. */
    origin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const inviter = await getCurrentUser(ctx);
    if (!inviter) {
      throwErr("AUTH_REQUIRED", "Must be signed in to invite someone", 401);
    }

    const room = await assertRoomJoinable(ctx, args.roomId);

    const email = args.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throwErr("INVALID_EMAIL", "Enter a valid email address", 400);
    }
    if (email === inviter!.email?.toLowerCase()) {
      throwErr("CANNOT_INVITE_SELF", "You cannot invite yourself", 400);
    }

    // Throttle after validation, so a mistyped address doesn't burn allowance,
    // but before anything is written or scheduled. Sending mail to an arbitrary
    // address is the expensive, abusable part of this mutation.
    await enforceInviteLimit(ctx, inviter!._id);

    // Capacity is checked against people actually in the call, not invites
    // outstanding — an invite is not a reservation.
    const activeParticipants = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    if (activeParticipants.length >= room.maxParticipants) {
      throwErr("ROOM_AT_CAPACITY", "This call is already full", 409);
    }

    const now = Date.now();
    // An invite must never outlive the room it points at.
    const expiresAt = room.endTime
      ? Math.min(room.endTime, now + DEFAULT_INVITE_TTL_MS)
      : now + DEFAULT_INVITE_TTL_MS;

    const note = args.note?.trim() ? args.note.trim().slice(0, 500) : undefined;

    // Supersede any still-pending invite for the same person and room, so an
    // older link cannot be used after a fresh one is issued.
    const previous = await ctx.db
      .query("roomInvites")
      .withIndex("by_room_and_email", (q) =>
        q.eq("roomId", args.roomId).eq("invitedEmail", email),
      )
      .collect();

    for (const invite of previous) {
      if (invite.status === "pending") {
        await ctx.db.patch(invite._id, { status: "revoked" });
      }
    }

    const token = generateInviteToken();
    const inviteId = await ctx.db.insert("roomInvites", {
      roomId: args.roomId,
      invitedEmail: email,
      invitedBy: inviter!._id,
      token,
      status: "pending",
      note,
      createdAt: now,
      expiresAt,
    });

    // Registered recipients also get the in-app notification.
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    if (existingUser && existingUser._id !== inviter!._id) {
      await ctx.db.insert("notifications", {
        recipientId: existingUser._id,
        senderId: inviter!._id,
        type: "call",
        title: `You're invited to join: ${room.name}`,
        body: "Tap to join the ongoing call.",
        roomId: room._id,
        read: false,
        createdAt: now,
      });
    }

    const origin = resolveAppOrigin(args.origin);

    await ctx.scheduler.runAfter(0, internal.email.sendRoomInvite, {
      inviteId,
      toEmail: email,
      inviterName: displayName(inviter),
      roomName: room.name,
      joinUrl: `${origin}/join/${token}`,
      expiresInLabel: formatDuration(expiresAt - now),
      note,
    });

    return {
      inviteId,
      email,
      // Handy for the UI and for copying the link manually in local dev.
      joinUrl: `${origin}/join/${token}`,
      hasAccount: existingUser !== null,
    };
  },
});

/**
 * Resolve a join token. Deliberately public and unauthenticated: the recipient
 * needs to see who invited them *before* deciding to sign in. Only non-sensitive
 * fields are returned, and never the room id for an unusable invite.
 */
export const getInviteByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("roomInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invite) {
      return { state: "not_found" as const };
    }

    const [room, inviter] = await Promise.all([
      ctx.db.get(invite.roomId),
      ctx.db.get(invite.invitedBy),
    ]);

    const base = {
      invitedEmail: invite.invitedEmail,
      inviterName: displayName(inviter),
      roomName: room?.name ?? "a call",
      expiresAt: invite.expiresAt,
    };

    if (invite.status === "revoked") {
      return { state: "revoked" as const, ...base };
    }
    if (invite.status === "accepted") {
      // Still hand back the room id — the person may simply have reloaded the
      // link, and they should be able to walk back into the call.
      return { state: "accepted" as const, ...base, roomId: invite.roomId };
    }
    if (Date.now() > invite.expiresAt) {
      return { state: "expired" as const, ...base };
    }
    if (!room) {
      return { state: "room_gone" as const, ...base };
    }

    const roomEnded =
      !room.isActive || (room.endTime !== undefined && Date.now() > room.endTime);
    if (roomEnded) {
      return { state: "room_ended" as const, ...base };
    }

    return {
      state: "valid" as const,
      ...base,
      roomId: invite.roomId,
      roomDescription: room.description,
      note: invite.note,
    };
  },
});

/**
 * Accept an invite and join the room in one step. Requires the caller to be
 * signed in — as a guest is fine, which is what makes one-click joining work
 * for people who have never used the app.
 */
export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throwErr("AUTH_REQUIRED", "Sign in to join this call", 401);
    }

    const invite = await ctx.db
      .query("roomInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invite) {
      throwErr("INVITE_NOT_FOUND", "This invitation link is not valid", 404);
    }
    if (invite!.status === "revoked") {
      throwErr("INVITE_REVOKED", "This invitation was cancelled", 410);
    }

    // Re-accepting your own already-accepted invite is a reload, not an error.
    const alreadyAcceptedBySomeoneElse =
      invite!.status === "accepted" &&
      invite!.acceptedBy !== undefined &&
      invite!.acceptedBy !== user!._id;

    if (alreadyAcceptedBySomeoneElse) {
      throwErr("INVITE_ALREADY_USED", "This invitation has already been used", 410);
    }

    if (invite!.status === "pending" && Date.now() > invite!.expiresAt) {
      throwErr("INVITE_EXPIRED", "This invitation has expired", 410);
    }

    // Throws ROOM_EXPIRED / ROOM_INACTIVE / ROOM_NOT_FOUND as appropriate.
    await assertRoomJoinable(ctx, invite!.roomId);

    await addParticipantToRoom(ctx, invite!.roomId, user!._id);

    if (invite!.status === "pending") {
      await ctx.db.patch(invite!._id, {
        status: "accepted",
        acceptedAt: Date.now(),
        acceptedBy: user!._id,
      });
    }

    return { roomId: invite!.roomId };
  },
});

/**
 * Invites for a room, so the sender can see delivery status.
 *
 * Scoped deliberately: an invite row contains a third party's email address, and
 * a room id is not a secret (it's in the URL, and any signed-in guest can hold
 * one). The host sees every invite for their own room; anyone else sees only the
 * invites they sent themselves.
 */
export const listRoomInvites = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const room = await ctx.db.get(args.roomId);
    if (!room) return [];

    const isHost = room.createdBy === user._id;

    const invites = await ctx.db
      .query("roomInvites")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();

    return invites
      .filter((invite) => isHost || invite.invitedBy === user._id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((invite) => ({
        _id: invite._id,
        invitedEmail: invite.invitedEmail,
        status: invite.status,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        emailDelivered: invite.emailDelivered,
        emailError: invite.emailError,
      }));
  },
});

/** Cancel a pending invite. Only the person who sent it, or the host, may do so. */
export const revokeInvite = mutation({
  args: { inviteId: v.id("roomInvites") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throwErr("AUTH_REQUIRED", "Must be signed in", 401);
    }

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) {
      throwErr("INVITE_NOT_FOUND", "Invitation not found", 404);
    }

    const room = await ctx.db.get(invite!.roomId);
    const isSender = invite!.invitedBy === user!._id;
    const isHost = room?.createdBy === user!._id;
    if (!isSender && !isHost) {
      throwErr("NOT_AUTHORIZED", "You cannot cancel this invitation", 403);
    }

    if (invite!.status === "pending") {
      await ctx.db.patch(invite!._id, { status: "revoked" });
    }
  },
});

/** Record the outcome of the delivery attempt. Called by the email action. */
export const recordInviteDelivery = internalMutation({
  args: {
    inviteId: v.id("roomInvites"),
    delivered: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) return;
    await ctx.db.patch(args.inviteId, {
      emailDelivered: args.delivered,
      emailError: args.error,
    });
  },
});
