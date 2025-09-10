import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Mutation: delete "call" notifications older than (now - thresholdMs)
const deleteExpiredCallInvites = internalMutation({
  args: { now: v.number(), thresholdMs: v.number() },
  handler: async (ctx, args) => {
    const cutoff = args.now - args.thresholdMs;

    // Use the composite index to efficiently find old "call" notifications
    const query = ctx.db
      .query("notifications")
      .withIndex("by_type_and_createdAt", (q) => q.eq("type", "call"))
      .order("asc");

    for await (const notif of query) {
      // Stop early if newer than cutoff
      if (notif.createdAt > cutoff) break;
      await ctx.db.delete(notif._id);
    }
  },
});

// Action: trigger cleanup with a 30s threshold
const triggerCleanup = internalAction({
  args: {},
  handler: async (ctx) => {
    const THIRTY_SECONDS = 30_000;
    await ctx.runMutation(internal.crons.deleteExpiredCallInvites, {
      now: Date.now(),
      thresholdMs: THIRTY_SECONDS,
    });
  },
});

const crons = cronJobs();

// Run every 30 seconds
crons.interval(
  "cleanup old call invitations",
  { seconds: 30 },
  internal.crons.triggerCleanup,
  {},
);

export default crons;
export { deleteExpiredCallInvites, triggerCleanup };
