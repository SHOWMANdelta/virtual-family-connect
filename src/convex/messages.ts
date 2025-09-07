import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

export const sendMessage = mutation({
  args: {
    roomId: v.id("rooms"),
    content: v.string(),
    messageType: v.optional(v.union(v.literal("text"), v.literal("system"), v.literal("alert"))),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("AUTH_REQUIRED: Must be authenticated");
    }

    // Validate room exists and is active
    const room = await ctx.db.get(args.roomId);
    if (!room) {
      throw new Error("ROOM_NOT_FOUND: Room does not exist");
    }
    if (!room.isActive) {
      throw new Error("ROOM_INACTIVE: Cannot send messages to inactive room");
    }

    // Ensure sender is an active participant
    const participant = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room_and_user", (q) => q.eq("roomId", args.roomId).eq("userId", user._id))
      .first();

    if (!participant || participant.leftAt) {
      throw new Error("NOT_IN_ROOM: You must be an active participant to send messages");
    }

    const messageId = await ctx.db.insert("messages", {
      roomId: args.roomId,
      senderId: user._id,
      content: args.content,
      messageType: args.messageType || "text",
      timestamp: Date.now(),
    });

    return messageId;
  },
});

export const getRoomMessages = query({
  args: {
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("AUTH_REQUIRED: Must be authenticated");
    }

    // Ensure the requesting user is a participant in the room
    const participant = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room_and_user", (q) => q.eq("roomId", args.roomId).eq("userId", user._id))
      .first();

    if (!participant || participant.leftAt) {
      // Return empty to avoid races while the client is joining or after leaving
      return [];
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();

    const messagesWithUsers = await Promise.all(
      messages.map(async (message) => {
        const sender = await ctx.db.get(message.senderId);
        return {
          ...message,
          sender,
        };
      })
    );

    return messagesWithUsers.sort((a, b) => a.timestamp - b.timestamp);
  },
});