import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { Doc } from "./_generated/dataModel";
import { throwErr } from "./errors";

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

    const room = await ctx.db.get(args.roomId);
    if (!room) {
      throwErr("ROOM_NOT_FOUND", "Room does not exist", 404);
    }

    // Add: Expiry enforcement before any other checks
    if (room!.endTime && Date.now() > room!.endTime) {
      if (room!.isActive) {
        await ctx.db.patch(room!._id, { isActive: false });
      }
      throwErr("ROOM_EXPIRED", "Room has expired", 410);
    }

    if (!room!.isActive) {
      throwErr("ROOM_INACTIVE", "Cannot join an inactive room", 403);
    }

    const existing = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room_and_user", (q) =>
        q.eq("roomId", args.roomId).eq("userId", user!._id)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (existing) {
      return existing._id;
    }

    const currentParticipants = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    if (currentParticipants.length >= room!.maxParticipants) {
      throwErr("ROOM_AT_CAPACITY", "Room is at capacity", 409);
    }

    const participantId = await ctx.db.insert("roomParticipants", {
      roomId: args.roomId,
      userId: user!._id,
      joinedAt: Date.now(),
      isHost: false,
      permissions: {
        canShare: false,
        canMute: false,
        canRecord: false,
      },
    });

    return participantId;
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

export const inviteUserToRoom = mutation({
  args: {
    roomId: v.id("rooms"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const requester = await getCurrentUser(ctx);
    if (!requester) {
      throwErr("AUTH_REQUIRED", "Must be authenticated to invite", 401);
    }

    const room = await ctx.db.get(args.roomId);
    if (!room) throwErr("ROOM_NOT_FOUND", "Room not found", 404);

    // Enforce expiry/inactive
    if (room!.endTime && Date.now() > room!.endTime) {
      if (room!.isActive) await ctx.db.patch(room!._id, { isActive: false });
      throwErr("ROOM_EXPIRED", "Room has expired", 410);
    }
    if (!room!.isActive) throwErr("ROOM_INACTIVE", "Room is inactive", 403);

    const email = args.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throwErr("INVALID_EMAIL", "Email must be valid", 400);
    }

    const recipient = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    if (!recipient) {
      throwErr("USER_NOT_FOUND", "No user exists with that email", 404);
    }

    if (recipient!._id === requester!._id) {
      throwErr("CANNOT_INVITE_SELF", "You cannot invite yourself", 400);
    }

    // Capacity check (only active participants)
    const activeParticipants = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    if (activeParticipants.length >= room!.maxParticipants) {
      throwErr("ROOM_AT_CAPACITY", "Room is at capacity", 409);
    }

    // Send in-app notification
    await ctx.db.insert("notifications", {
      recipientId: recipient!._id,
      senderId: requester!._id,
      type: "call",
      title: `You're invited to join: ${room!.name}`,
      body: "Tap to join the ongoing call.",
      roomId: room!._id,
      read: false,
      createdAt: Date.now(),
    });
  },
});