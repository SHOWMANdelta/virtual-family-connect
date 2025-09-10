import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Mutation: delete "call" notifications older than (now - thresholdMs)
const deleteExpiredCallInvites = internalMutation({
  args: { thresholdMs: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cutoff = now - args.thresholdMs;

    // Use the composite index to efficiently find old "call" notifications
    const query = ctx.db
      .query("notifications")
      .withIndex("by_type_and_createdAt", (q) => q.eq("type", "call"))
      .order("asc");

    // Add: robust error handling and metrics
    let scanned = 0;
    let deleted = 0;
    let failed = 0;

    for await (const notif of query) {
      scanned++;
      // Stop early if newer than cutoff
      if (notif.createdAt > cutoff) break;

      try {
        await ctx.db.delete(notif._id);
        deleted++;
      } catch (err) {
        failed++;
        console.error("[crons.deleteExpiredCallInvites] Failed to delete", {
          notifId: notif._id,
          error: err,
        });
        // continue to next record
      }
    }

    // Return structured metrics for visibility
    return { scanned, deleted, failed, cutoff };
  },
});

const crons = cronJobs();

// Run every 30 seconds
crons.interval(
  "cleanup old call invitations",
  { seconds: 30 },
  internal.crons.deleteExpiredCallInvites,
  { thresholdMs: 30_000 },
);

export default crons;
// Only re-export the mutation
export { deleteExpiredCallInvites };