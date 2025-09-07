import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

export const getMyNotifications = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_recipient", (q) => q.eq("recipientId", user._id))
      .collect();

    // newest first on client is fine; here return ascending to keep consistent
    return rows;
  },
});

export const markAsRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Must be authenticated");

    const notif = await ctx.db.get(args.notificationId);
    if (!notif) throw new Error("Notification not found");
    if (notif.recipientId !== user._id) throw new Error("Not authorized");

    await ctx.db.patch(args.notificationId, { read: true, readAt: Date.now() });
  },
});
