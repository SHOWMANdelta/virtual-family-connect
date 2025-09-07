import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

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
    if (!user) throw new Error("Must be authenticated");
    if (user._id !== args.fromUserId) throw new Error("Not authorized to send as another user");
    return await ctx.db.insert("signals", {
      roomId: args.roomId,
      fromUserId: args.fromUserId,
      toUserId: args.toUserId,
      kind: args.kind,
      payload: args.payload,
      createdAt: Date.now(),
    });
  },
});

export const getSignals = query({
  args: {
    roomId: v.id("rooms"),
    forUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Return signals for this user in this room
    const rows = await ctx.db
      .query("signals")
      .withIndex("by_room_and_to", (q) => q.eq("roomId", args.roomId).eq("toUserId", args.forUserId))
      .collect();
    return rows;
  },
});

export const acknowledgeSignals = mutation({
  args: {
    signalIds: v.array(v.id("signals")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Must be authenticated");
    // Best-effort delete; ignore not found
    for (const id of args.signalIds) {
      const s = await ctx.db.get(id);
      if (s && s.toUserId === user._id) {
        await ctx.db.delete(id);
      }
    }
    return true;
  },
});
