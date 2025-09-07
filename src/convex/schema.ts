import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  PATIENT: "patient",
  RELATIVE: "relative",
  HEALTHCARE_PROVIDER: "healthcare_provider",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.PATIENT),
  v.literal(ROLES.RELATIVE),
  v.literal(ROLES.HEALTHCARE_PROVIDER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
      
      // Additional fields for healthcare app
      phoneNumber: v.optional(v.string()),
      dateOfBirth: v.optional(v.string()),
      emergencyContact: v.optional(v.string()),
      medicalId: v.optional(v.string()),
      isOnline: v.optional(v.boolean()),
      lastSeen: v.optional(v.number()),
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Rooms for video conferencing
    rooms: defineTable({
      name: v.string(),
      description: v.optional(v.string()),
      createdBy: v.id("users"),
      isActive: v.boolean(),
      maxParticipants: v.number(),
      roomType: v.union(v.literal("consultation"), v.literal("monitoring"), v.literal("family")),
      scheduledTime: v.optional(v.number()),
      endTime: v.optional(v.number()),
    }).index("by_creator", ["createdBy"])
      .index("by_active", ["isActive"])
      .index("by_type", ["roomType"]),

    // Room participants
    roomParticipants: defineTable({
      roomId: v.id("rooms"),
      userId: v.id("users"),
      joinedAt: v.number(),
      leftAt: v.optional(v.number()),
      isHost: v.boolean(),
      permissions: v.object({
        canShare: v.boolean(),
        canMute: v.boolean(),
        canRecord: v.boolean(),
      }),
    }).index("by_room", ["roomId"])
      .index("by_user", ["userId"])
      .index("by_room_and_user", ["roomId", "userId"]),

    // Patient-Relative connections
    connections: defineTable({
      patientId: v.id("users"),
      relativeId: v.id("users"),
      relationship: v.string(), // "spouse", "child", "parent", "sibling", etc.
      isApproved: v.boolean(),
      requestedBy: v.id("users"),
      approvedAt: v.optional(v.number()),
      notes: v.optional(v.string()),
    }).index("by_patient", ["patientId"])
      .index("by_relative", ["relativeId"])
      .index("by_approval", ["isApproved"]),

    // Monitoring sessions
    monitoringSessions: defineTable({
      patientId: v.id("users"),
      roomId: v.id("rooms"),
      startTime: v.number(),
      endTime: v.optional(v.number()),
      vitals: v.optional(v.object({
        heartRate: v.optional(v.number()),
        bloodPressure: v.optional(v.string()),
        temperature: v.optional(v.number()),
        oxygenSaturation: v.optional(v.number()),
      })),
      notes: v.optional(v.string()),
      alertsTriggered: v.array(v.string()),
    }).index("by_patient", ["patientId"])
      .index("by_room", ["roomId"])
      .index("by_start_time", ["startTime"]),

    // Messages for chat during video calls
    messages: defineTable({
      roomId: v.id("rooms"),
      senderId: v.id("users"),
      content: v.string(),
      messageType: v.union(v.literal("text"), v.literal("system"), v.literal("alert")),
      timestamp: v.number(),
    }).index("by_room", ["roomId"])
      .index("by_sender", ["senderId"]),

    // Appointments
    appointments: defineTable({
      patientId: v.id("users"),
      providerId: v.optional(v.id("users")),
      relativeIds: v.array(v.id("users")),
      title: v.string(),
      description: v.optional(v.string()),
      scheduledTime: v.number(),
      duration: v.number(), // in minutes
      status: v.union(
        v.literal("scheduled"),
        v.literal("in_progress"),
        v.literal("completed"),
        v.literal("cancelled")
      ),
      roomId: v.optional(v.id("rooms")),
      type: v.union(v.literal("consultation"), v.literal("monitoring"), v.literal("family_visit")),
    }).index("by_patient", ["patientId"])
      .index("by_provider", ["providerId"])
      .index("by_status", ["status"])
      .index("by_scheduled_time", ["scheduledTime"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;