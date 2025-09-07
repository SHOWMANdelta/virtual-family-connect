import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

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
      // If the patient doesn't exist yet, still send an email invite and succeed
      const appOrigin =
        process.env.APP_ORIGIN ||
        (typeof process !== "undefined" ? "http://localhost:5173" : "http://localhost:5173");
      const inviterNameOrEmail = user.name || user.email || "A contact";

      await ctx.scheduler.runAfter(
        0,
        internal.email.sendConnectionInvite,
        {
          toEmail: args.patientEmail,
          inviterNameOrEmail,
          relationship: args.relationship,
          appOrigin,
        }
      );

      // No connection record to create without a patient user; return success
      return null;
    }

    if (patient._id === user._id) {
      throw new Error("Cannot connect to yourself");
    }

    // Efficient duplicate check using composite index
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_patient_and_relative", (q) =>
        q.eq("patientId", patient._id).eq("relativeId", user._id)
      )
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

    // Schedule non-blocking email invite
    const appOrigin = process.env.APP_ORIGIN || (typeof process !== "undefined" ? "http://localhost:5173" : "http://localhost:5173");
    const inviterNameOrEmail = user.name || user.email || "A contact";

    await ctx.scheduler.runAfter(
      0,
      internal.email.sendConnectionInvite,
      {
        toEmail: patient.email || "",
        inviterNameOrEmail,
        relationship: args.relationship,
        appOrigin,
      }
    );

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

export const initiateCall = mutation({
  args: {
    connectionId: v.id("connections"),
    roomType: v.optional(v.union(v.literal("family"), v.literal("consultation"), v.literal("monitoring"))),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Must be authenticated");

    const connection = await ctx.db.get(args.connectionId);
    if (!connection) throw new Error("Connection not found");
    if (!connection.isApproved) throw new Error("Connection not approved");

    const isParticipant =
      connection.patientId === user._id || connection.relativeId === user._id;
    if (!isParticipant) throw new Error("Not authorized for this connection");

    const recipientId: Id<"users"> =
      connection.patientId === user._id ? connection.relativeId : connection.patientId;

    // Create a room for the call
    const caller = await ctx.db.get(user._id);
    const recipient = await ctx.db.get(recipientId);
    const roomId = await ctx.db.insert("rooms", {
      name: `Call: ${caller?.name || caller?.email || "User"} ↔ ${recipient?.name || recipient?.email || "User"}`,
      description: "Direct call initiated from Connections",
      createdBy: user._id,
      isActive: true,
      maxParticipants: 10,
      roomType: args.roomType || "family",
      scheduledTime: undefined,
      endTime: undefined,
    });

    // Add caller as host participant
    await ctx.db.insert("roomParticipants", {
      roomId,
      userId: user._id,
      joinedAt: Date.now(),
      isHost: true,
      permissions: { canShare: true, canMute: true, canRecord: true },
    });

    // Send notification to recipient
    await ctx.db.insert("notifications", {
      recipientId,
      senderId: user._id,
      type: "call",
      title: `Incoming video call from ${caller?.name || caller?.email || "a contact"}`,
      body: "Tap to join the call.",
      roomId,
      read: false,
      createdAt: Date.now(),
    });

    return roomId;
  },
});

export const sendMessageToConnection = mutation({
  args: {
    connectionId: v.id("connections"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Must be authenticated");

    const connection = await ctx.db.get(args.connectionId);
    if (!connection) throw new Error("Connection not found");
    if (!connection.isApproved) throw new Error("Connection not approved");

    const isParticipant =
      connection.patientId === user._id || connection.relativeId === user._id;
    if (!isParticipant) throw new Error("Not authorized for this connection");

    const recipientId: Id<"users"> =
      connection.patientId === user._id ? connection.relativeId : connection.patientId;

    await ctx.db.insert("notifications", {
      recipientId,
      senderId: user._id,
      type: "message",
      title: `${user.name || user.email || "Contact"} sent you a message`,
      body: args.content,
      roomId: undefined,
      read: false,
      createdAt: Date.now(),
    });

    return true;
  },
});