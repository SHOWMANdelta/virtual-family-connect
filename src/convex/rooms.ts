import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { Doc } from "./_generated/dataModel";

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
      throw new Error("Must be authenticated to create a room");
    }

    const roomId = await ctx.db.insert("rooms", {
      name: args.name,
      description: args.description,
      createdBy: user._id,
      isActive: true,
      maxParticipants: args.maxParticipants || 10,
      roomType: args.roomType,
      scheduledTime: args.scheduledTime,
    });

    // Add creator as host participant
    await ctx.db.insert("roomParticipants", {
      roomId,
      userId: user._id,
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
      throw new Error("Must be authenticated to join a room");
    }

    const room = await ctx.db.get(args.roomId);
    if (!room || !room.isActive) {
      throw new Error("Room not found or inactive");
    }

    // Check if already in room
    const existing = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room_and_user", (q) => 
        q.eq("roomId", args.roomId).eq("userId", user._id)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (existing) {
      return existing._id;
    }

    // Check room capacity
    const currentParticipants = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    if (currentParticipants.length >= room.maxParticipants) {
      throw new Error("Room is at capacity");
    }

    const participantId = await ctx.db.insert("roomParticipants", {
      roomId: args.roomId,
      userId: user._id,
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
      throw new Error("Must be authenticated");
    }

    const participant = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room_and_user", (q) => 
        q.eq("roomId", args.roomId).eq("userId", user._id)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (participant) {
      await ctx.db.patch(participant._id, {
        leftAt: Date.now(),
      });
    }
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

    return nonNullRooms;
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