/**
 * Outbound transactional email.
 *
 * These are `internalAction`s so they can be scheduled from mutations and do
 * network I/O. There is no `"use node"` directive: delivery is a plain `fetch`,
 * which runs in Convex's default runtime with a much faster cold start.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  EmailDeliveryError,
  type EmailErrorCode,
  sendEmail,
} from "./emailDelivery";
import { escapeHtml, renderRoomInviteEmail } from "./emailTemplates";

/** Retries for a transient failure, on top of the ones inside `sendEmail`. */
const MAX_INVITE_ATTEMPTS = 3;

/** Delay before rescheduling attempt 2 and attempt 3, in ms. */
const INVITE_RETRY_DELAYS_MS = [30_000, 5 * 60_000];

/**
 * Explain a delivery failure to the person who sent the invitation.
 *
 * This lands in `roomInvites.emailError`, which the room UI shows to the host —
 * so it has to be a sentence they can act on, not a provider error dump. The
 * host is authenticated and owns the room, so naming a configuration problem is
 * appropriate here in a way it isn't on the public sign-in endpoint.
 */
function hostFacingReason(code: EmailErrorCode): string {
  switch (code) {
    case "EMAIL_NOT_CONFIGURED":
      return "Email isn't set up on this server, so nothing was sent. Copy the invite link and share it directly.";
    case "EMAIL_SENDER_UNVERIFIED":
      return "This server can't email outside addresses yet — its sending address isn't verified. Copy the invite link and share it directly.";
    case "EMAIL_QUOTA_EXCEEDED":
      return "The server has hit its email sending limit for now. Copy the invite link and share it directly.";
    case "EMAIL_AUTH_FAILED":
      return "The server's email credentials were rejected. Copy the invite link and share it directly.";
    case "EMAIL_REJECTED":
      return "That address was rejected as undeliverable — check it for typos, then invite again.";
    case "EMAIL_TEMPORARY_FAILURE":
      return "Email delivery is failing right now. The invite link still works, so you can share it directly.";
  }
}

/**
 * "Join this video call" invitation — the email behind `invites.sendRoomInvite`.
 *
 * Never throws. A failed send is recorded on the invite row so the host sees
 * what happened and the link stays usable; a *transient* failure is also
 * rescheduled, because a provider blip shouldn't be the difference between an
 * invitation arriving and not.
 */
export const sendRoomInvite = internalAction({
  args: {
    inviteId: v.id("roomInvites"),
    toEmail: v.string(),
    inviterName: v.string(),
    roomName: v.string(),
    joinUrl: v.string(),
    expiresInLabel: v.string(),
    note: v.optional(v.string()),
    /** 1-based; incremented when a transient failure is rescheduled. */
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const attempt = args.attempt ?? 1;

    const { subject, html, text } = renderRoomInviteEmail({
      joinUrl: args.joinUrl,
      roomName: args.roomName,
      inviterName: args.inviterName,
      expiresInLabel: args.expiresInLabel,
      personalNote: args.note,
    });

    try {
      const result = await sendEmail({
        to: args.toEmail,
        subject,
        html,
        text,
        kind: "room invite",
      });

      await ctx.runMutation(internal.invites.recordInviteDelivery, {
        inviteId: args.inviteId,
        delivered: result.delivered,
        error: result.delivered
          ? undefined
          : // The console fallback ran (EMAIL_DEV_LOG). Say so plainly: the host
            // needs to know the recipient got nothing.
            "Email isn't set up on this server, so the invite was written to the server log instead of being sent. Copy the invite link and share it directly.",
      });
      return;
    } catch (error) {
      const isDeliveryError = error instanceof EmailDeliveryError;
      const detail = isDeliveryError
        ? error.operatorDetail
        : error instanceof Error
          ? error.message
          : String(error);

      console.error(
        `Room invite to ${args.toEmail} failed (attempt ${attempt}/${MAX_INVITE_ATTEMPTS}): ${detail}`,
      );

      const transient = isDeliveryError ? error.transient : true;
      const delay = INVITE_RETRY_DELAYS_MS[attempt - 1];

      if (transient && attempt < MAX_INVITE_ATTEMPTS && delay !== undefined) {
        await ctx.scheduler.runAfter(delay, internal.email.sendRoomInvite, {
          ...args,
          attempt: attempt + 1,
        });
        await ctx.runMutation(internal.invites.recordInviteDelivery, {
          inviteId: args.inviteId,
          delivered: false,
          error: "Sending is taking longer than usual — retrying shortly.",
        });
        return;
      }

      await ctx.runMutation(internal.invites.recordInviteDelivery, {
        inviteId: args.inviteId,
        delivered: false,
        error: isDeliveryError
          ? hostFacingReason(error.code)
          : "The invitation couldn't be emailed. The invite link still works, so you can share it directly.",
      });
    }
  },
});

/** Connection request notification (used by connections.requestConnection). */
export const sendConnectionInvite = internalAction({
  args: {
    toEmail: v.string(),
    inviterNameOrEmail: v.string(),
    relationship: v.string(),
    appOrigin: v.string(),
  },
  handler: async (_ctx, args) => {
    const openUrl = `${args.appOrigin}/dashboard`;
    const inviter = escapeHtml(args.inviterNameOrEmail);
    const relationship = escapeHtml(args.relationship);

    const html = `<!doctype html>
<html>
  <body style="margin:0;padding:32px 12px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px;">
          <tr><td>
            <h1 style="margin:0 0 16px;font-size:22px;color:#0f172a;">Connection request</h1>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569;">
              <strong style="color:#0f172a;">${inviter}</strong> wants to connect with you as
              <strong style="color:#0f172a;">${relationship}</strong> on HealthConnect.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
              <tr><td style="border-radius:10px;background:#2563eb;">
                <a href="${escapeHtml(openUrl)}" style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">
                  Review the request
                </a>
              </td></tr>
            </table>
            <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;word-break:break-all;">
              Or paste this link into your browser:<br/>
              <a href="${escapeHtml(openUrl)}" style="color:#2563eb;">${escapeHtml(openUrl)}</a>
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

    try {
      await sendEmail({
        to: args.toEmail,
        subject: `${args.inviterNameOrEmail} wants to connect with you on HealthConnect`,
        html,
        text: [
          `${args.inviterNameOrEmail} wants to connect with you as ${args.relationship} on HealthConnect.`,
          "",
          "Review the request:",
          openUrl,
        ].join("\n"),
        kind: "connection request",
      });
    } catch (error) {
      // Non-critical: the in-app request already exists, and the recipient sees
      // it the next time they open the dashboard.
      const detail =
        error instanceof EmailDeliveryError
          ? error.operatorDetail
          : error instanceof Error
            ? error.message
            : String(error);
      console.error(`Connection invite email to ${args.toEmail} failed: ${detail}`);
    }
  },
});
