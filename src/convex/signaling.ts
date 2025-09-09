import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { throwErr } from "./errors";

export const sendSignal = mutation({
  args: {
    roomId: v.id("rooms"),
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    kind: v.union(v.literal("offer"), v.literal("answer"), v.literal("candidate"), v.literal("leave")),
    payload: v.object({
      sdp: v.optional(v.string()),
      type: v.optional(v.string()),
      candidate: v.optional(v.string()),
      sdpMid: v.optional(v.string()),
      sdpMLineIndex: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throwErr("AUTH_REQUIRED", "Must be authenticated", 401);
    if (user!._id !== args.fromUserId) throwErr("NOT_ALLOWED", "Cannot send on behalf of another user", 403);

    // Verify sender is a participant of the room
    const fromParticipant = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room_and_user", (q) => q.eq("roomId", args.roomId).eq("userId", args.fromUserId))
      .first();
    if (!fromParticipant || fromParticipant.leftAt) {
      throwErr("NOT_IN_ROOM", "Sender is not an active participant in the room", 403);
    }

    // Ensure room exists and is active (avoid sending into dead/expired rooms)
    const room = await ctx.db.get(args.roomId);
    if (!room) throwErr("ROOM_NOT_FOUND", "Room does not exist", 404);
    const isExpired = room!.endTime && Date.now() > room!.endTime;
    if (isExpired || !room!.isActive) {
      throwErr("ROOM_INACTIVE_OR_EXPIRED", "Cannot send signals to inactive/expired room", 403);
    }

    try {
      return await ctx.db.insert("signals", {
        roomId: args.roomId,
        fromUserId: args.fromUserId,
        toUserId: args.toUserId,
        kind: args.kind,
        payload: args.payload,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.error("SIGNAL_SEND_FAILED", { err, args: { ...args, payload: "omitted" } });
      throwErr("SIGNAL_SEND_FAILED", "Unable to enqueue signal", 500);
    }
  },
});

export const getSignals = query({
  args: {
    roomId: v.id("rooms"),
    forUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throwErr("AUTH_REQUIRED", "Must be authenticated", 401);
    if (user!._id !== args.forUserId) throwErr("NOT_ALLOWED", "Cannot read signals for another user", 403);

    // Ensure the requesting user is a participant in the room
    const participant = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room_and_user", (q) => q.eq("roomId", args.roomId).eq("userId", args.forUserId))
      .first();
    if (!participant) {
      // Return empty to avoid race while client is in the process of joining
      return [];
    }

    try {
      const rows = await ctx.db
        .query("signals")
        .withIndex("by_room_and_to", (q) => q.eq("roomId", args.roomId).eq("toUserId", args.forUserId))
        .collect();
      return rows;
    } catch (err) {
      console.error("SIGNAL_FETCH_FAILED", { err, args });
      throwErr("SIGNAL_FETCH_FAILED", "Unable to fetch signals", 500);
    }
  },
});

export const acknowledgeSignals = mutation({
  args: {
    signalIds: v.array(v.id("signals")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throwErr("AUTH_REQUIRED", "Must be authenticated", 401);

    try {
      for (const id of args.signalIds) {
        const s = await ctx.db.get(id);
        if (!s) continue;
        if (s.toUserId !== user!._id) {
          // Skip silently to avoid leaking existence; could log
          continue;
        }
        await ctx.db.delete(id);
      }
      return true;
    } catch (err) {
      console.error("SIGNAL_ACK_FAILED", { err, argsCount: args.signalIds.length });
      throwErr("SIGNAL_ACK_FAILED", "Unable to acknowledge signals", 500);
    }
  },
});