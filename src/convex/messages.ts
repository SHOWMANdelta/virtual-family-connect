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
      throw new Error("Must be authenticated");
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
