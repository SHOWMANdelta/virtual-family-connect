import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

export const createAppointment = mutation({
  args: {
    patientId: v.optional(v.id("users")),
    relativeIds: v.array(v.id("users")),
    title: v.string(),
    description: v.optional(v.string()),
    scheduledTime: v.number(),
    duration: v.number(),
    type: v.union(v.literal("consultation"), v.literal("monitoring"), v.literal("family_visit")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("AUTH_REQUIRED: Must be authenticated");
    }

    // Validate times
    if (args.duration <= 0 || args.duration > 24 * 60) {
      throw new Error("INVALID_DURATION: Duration must be between 1 and 1440 minutes");
    }
    if (args.scheduledTime <= 0) {
      throw new Error("INVALID_SCHEDULE: scheduledTime must be a valid timestamp");
    }

    // Validate relatives exist
    const relDocs = await Promise.all(args.relativeIds.map((id) => ctx.db.get(id)));
    if (relDocs.some((r) => r === null)) {
      throw new Error("INVALID_RELATIVES: One or more relatives do not exist");
    }

    // Validate patient (if provided)
    const patientId = args.patientId || user._id;
    const patientDoc = await ctx.db.get(patientId);
    if (!patientDoc) {
      throw new Error("PATIENT_NOT_FOUND: Patient user does not exist");
    }

    const appointmentId = await ctx.db.insert("appointments", {
      patientId,
      providerId: user.role === "healthcare_provider" ? user._id : undefined,
      relativeIds: args.relativeIds,
      title: args.title,
      description: args.description,
      scheduledTime: args.scheduledTime,
      duration: args.duration,
      status: "scheduled",
      type: args.type,
    });

    return appointmentId;
  },
});

export const getMyAppointments = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    // Get appointments where user is patient
    const asPatient = await ctx.db
      .query("appointments")
      .withIndex("by_patient", (q) => q.eq("patientId", user._id))
      .collect();

    // Get appointments where user is provider
    const asProvider = user.role === "healthcare_provider" 
      ? await ctx.db
          .query("appointments")
          .withIndex("by_provider", (q) => q.eq("providerId", user._id))
          .collect()
      : [];

    // Get appointments where user is a relative
    const allAppointments = await ctx.db.query("appointments").collect();
    const asRelative = allAppointments.filter(apt => 
      apt.relativeIds.includes(user._id)
    );

    const uniqueAppointments = new Map();
    [...asPatient, ...asProvider, ...asRelative].forEach(apt => {
      uniqueAppointments.set(apt._id, apt);
    });

    const appointments = Array.from(uniqueAppointments.values());

    const appointmentsWithUsers = await Promise.all(
      appointments.map(async (appointment) => {
        const patient = appointment.patientId ? await ctx.db.get(appointment.patientId) : null;
        const provider = appointment.providerId ? await ctx.db.get(appointment.providerId) : null;
        const relatives = await Promise.all(
          appointment.relativeIds.map((id: any) => ctx.db.get(id))
        );

        return {
          ...appointment,
          patient,
          provider,
          relatives: relatives.filter(Boolean),
        };
      })
    );

    return appointmentsWithUsers.sort((a, b) => a.scheduledTime - b.scheduledTime);
  },
});

export const startAppointment = mutation({
  args: {
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("AUTH_REQUIRED: Must be authenticated");
    }

    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) {
      throw new Error("APPOINTMENT_NOT_FOUND: Appointment does not exist");
    }

    // Authorization: must be the patient, provider, or a listed relative
    const isPatient = appointment.patientId === user._id;
    const isProvider = appointment.providerId === user._id;
    const isRelative = appointment.relativeIds.some((id) => id === user._id);
    if (!isPatient && !isProvider && !isRelative) {
      throw new Error("NOT_AUTHORIZED: You are not a participant in this appointment");
    }

    // Prevent duplicate room creation
    if (appointment.roomId) {
      return appointment.roomId;
    }

    const roomId = await ctx.db.insert("rooms", {
      name: `${appointment.title} - ${new Date(appointment.scheduledTime).toLocaleString()}`,
      description: appointment.description,
      createdBy: user._id,
      isActive: true,
      maxParticipants: 10,
      roomType: appointment.type === "family_visit" ? "family" : appointment.type,
    });

    await ctx.db.patch(args.appointmentId, {
      status: "in_progress",
      roomId,
    });

    return roomId;
  },
});