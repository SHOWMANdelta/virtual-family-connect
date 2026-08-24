import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./users";
import type { Doc, Id } from "./_generated/dataModel";
import { throwErr } from "./errors";

/**
 * Load a room and assert it can still be joined.
 *
 * Flips `isActive` off as a side effect when a room has passed its `endTime`, so
 * an expired room stops showing up in listings. Shared by `joinRoom` and by the
 * invite flow in ./invites so the rules can't drift apart.
 */
export async function assertRoomJoinable(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
): Promise<Doc<"rooms">> {
  const room = await ctx.db.get(roomId);
  if (!room) {
    throwErr("ROOM_NOT_FOUND", "Room does not exist", 404);
  }

  if (room!.endTime && Date.now() > room!.endTime) {
    if (room!.isActive) {
      await ctx.db.patch(room!._id, { isActive: false });
    }
    throwErr("ROOM_EXPIRED", "Room has expired", 410);
  }

  if (!room!.isActive) {
    throwErr("ROOM_INACTIVE", "Cannot join an inactive room", 403);
  }

  return room!;
}

/**
 * Add a user to a room as a participant, honouring capacity. Idempotent: an
 * existing active membership is returned rather than duplicated.
 */
export async function addParticipantToRoom(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  userId: Id<"users">,
  isHost = false,
): Promise<Id<"roomParticipants">> {
  const existing = await ctx.db
    .query("roomParticipants")
    .withIndex("by_room_and_user", (q) =>
      q.eq("roomId", roomId).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();

  if (existing) {
    return existing._id;
  }

  const room = await ctx.db.get(roomId);
  const currentParticipants = await ctx.db
    .query("roomParticipants")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .collect();

  if (room && currentParticipants.length >= room.maxParticipants) {
    throwErr("ROOM_AT_CAPACITY", "Room is at capacity", 409);
  }

  return await ctx.db.insert("roomParticipants", {
    roomId,
    userId,
    joinedAt: Date.now(),
    isHost,
    permissions: {
      canShare: isHost,
      canMute: isHost,
      canRecord: isHost,
    },
  });
}

export const createRoom = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    roomType: v.union(v.literal("consultation"), v.literal("monitoring"), v.literal("family")),
    maxParticipants: v.optional(v.number()),
    scheduledTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throwErr("AUTH_REQUIRED", "Must be authenticated to create a room", 401);
    }

    // Basic validation
    const name = args.name.trim();
    if (name.length < 2) {
      throwErr("INVALID_ROOM_NAME", "Room name must be at least 2 characters", 400);
    }
    const maxParticipants = args.maxParticipants ?? 10;
    if (maxParticipants < 2 || maxParticipants > 50) {
      throwErr("INVALID_CAPACITY", "maxParticipants must be between 2 and 50", 400);
    }
    if (args.scheduledTime && args.scheduledTime < 0) {
      throwErr("INVALID_SCHEDULE", "scheduledTime must be a valid timestamp", 400);
    }

    // Add: compute endTime to enforce 30-minute expiry
    const THIRTY_MIN_MS = 30 * 60 * 1000;
    const now = Date.now();
    const startTime = args.scheduledTime && args.scheduledTime > now ? args.scheduledTime : now;
    const endTime = startTime + THIRTY_MIN_MS;

    const roomId = await ctx.db.insert("rooms", {
      name,
      description: args.description,
      createdBy: user!._id,
      isActive: true,
      maxParticipants,
      roomType: args.roomType,
      scheduledTime: args.scheduledTime,
      // Add: endTime for auto-expiry
      endTime,
    });

    await ctx.db.insert("roomParticipants", {
      roomId,
      userId: user!._id,
      joinedAt: Date.now(),
      isHost: true,
      permissions: {
        canShare: true,
        canMute: true,
        canRecord: true,
      },
    });

    return roomId;
  },
});

export const joinRoom = mutation({
  args: {
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throwErr("AUTH_REQUIRED", "Must be authenticated to join a room", 401);
    }

    await assertRoomJoinable(ctx, args.roomId);
    return await addParticipantToRoom(ctx, args.roomId, user!._id);
  },
});

export const leaveRoom = mutation({
  args: {
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throwErr("AUTH_REQUIRED", "Must be authenticated", 401);
    }

    const participant = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room_and_user", (q) =>
        q.eq("roomId", args.roomId).eq("userId", user!._id)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!participant) {
      // Not an error — idempotent leave
      return;
    }

    await ctx.db.patch(participant._id, {
      leftAt: Date.now(),
    });
  },
});

export const getRoomParticipants = query({
  args: {
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    const participants = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const participantsWithUsers = await Promise.all(
      participants.map(async (participant) => {
        const user = await ctx.db.get(participant.userId);
        return {
          ...participant,
          user,
        };
      })
    );

    return participantsWithUsers;
  },
});

export const getUserRooms = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    const participantRecords = await ctx.db
      .query("roomParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const roomDocs = await Promise.all(
      participantRecords.map(async (participant) => {
        const room = await ctx.db.get(participant.roomId);
        return room;
      })
    );

    // Narrow to non-null rooms for correct typing on the frontend
    const nonNullRooms: Doc<"rooms">[] = roomDocs.filter(
      (r): r is Doc<"rooms"> => r !== null
    );

    // Add: filter out expired or inactive rooms
    const now = Date.now();
    const activeAndUnexpired = nonNullRooms.filter((r) => {
      const notExpired = !r.endTime || now <= r.endTime;
      return r.isActive && notExpired;
    });

    return activeAndUnexpired;
  },
});

export const getRoom = query({
  args: {
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.roomId);
  },
});

// Inviting someone to a room now lives in ./invites (`invites.sendRoomInvite`).
// The old `inviteUserToRoom` only wrote an in-app notification and rejected any
// address that wasn't already registered, which made emailed invitations
// impossible. See src/convex/invites.ts.

export const getRoomHealth = query({
  args: {
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) {
      throwErr("ROOM_NOT_FOUND", "Room not found", 404);
    }
    const now = Date.now();
    const expired = !!(room!.endTime && now > room!.endTime);

    const activeParticipants = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    return {
      isActive: room!.isActive,
      expired,
      endTime: room!.endTime ?? null,
      maxParticipants: room!.maxParticipants,
      activeCount: activeParticipants.length,
    };
  },
});