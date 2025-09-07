import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

export const requestConnection = mutation({
  args: {
    patientEmail: v.string(),
    relationship: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Must be authenticated");
    }

    // Find patient by email
    const patient = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.patientEmail))
      .first();

    if (!patient) {
      throw new Error("Patient not found");
    }

    if (patient._id === user._id) {
      throw new Error("Cannot connect to yourself");
    }

    // Check if connection already exists
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_patient", (q) => q.eq("patientId", patient._id))
      .filter((q) => q.eq(q.field("relativeId"), user._id))
      .first();

    if (existing) {
      throw new Error("Connection request already exists");
    }

    const connectionId = await ctx.db.insert("connections", {
      patientId: patient._id,
      relativeId: user._id,
      relationship: args.relationship,
      isApproved: false,
      requestedBy: user._id,
      notes: args.notes,
    });

    return connectionId;
  },
});

export const approveConnection = mutation({
  args: {
    connectionId: v.id("connections"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Must be authenticated");
    }

    const connection = await ctx.db.get(args.connectionId);
    if (!connection) {
      throw new Error("Connection not found");
    }

    // Only the patient can approve connections
    if (connection.patientId !== user._id) {
      throw new Error("Only the patient can approve connections");
    }

    await ctx.db.patch(args.connectionId, {
      isApproved: true,
      approvedAt: Date.now(),
    });
  },
});

export const getMyConnections = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    // Get connections where user is patient
    const asPatient = await ctx.db
      .query("connections")
      .withIndex("by_patient", (q) => q.eq("patientId", user._id))
      .collect();

    // Get connections where user is relative
    const asRelative = await ctx.db
      .query("connections")
      .withIndex("by_relative", (q) => q.eq("relativeId", user._id))
      .collect();

    const allConnections = [...asPatient, ...asRelative];

    const connectionsWithUsers = await Promise.all(
      allConnections.map(async (connection) => {
        const patient = await ctx.db.get(connection.patientId);
        const relative = await ctx.db.get(connection.relativeId);
        return {
          ...connection,
          patient,
          relative,
          isPatient: connection.patientId === user._id,
        };
      })
    );

    return connectionsWithUsers;
  },
});

export const getPendingRequests = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    const pending = await ctx.db
      .query("connections")
      .withIndex("by_patient", (q) => q.eq("patientId", user._id))
      .filter((q) => q.eq(q.field("isApproved"), false))
      .collect();

    const pendingWithUsers = await Promise.all(
      pending.map(async (connection) => {
        const relative = await ctx.db.get(connection.relativeId);
        return {
          ...connection,
          relative,
        };
      })
    );

    return pendingWithUsers;
  },
});
