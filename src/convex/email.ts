"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

type ResendEmailPayload = {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
};

export const sendConnectionInvite = internalAction({
  args: {
    toEmail: v.string(),
    inviterNameOrEmail: v.string(),
    relationship: v.string(),
    appOrigin: v.string(),
  },
  handler: async (ctx, args) => {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      console.warn("RESEND_API_KEY not set; skipping email send.");
      return;
    }

    const joinUrl = `${args.appOrigin}/dashboard`; // Landing to approve/join
    const subject = `You have a connection request on HealthConnect`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>HealthConnect — Connection Request</h2>
        <p><strong>${args.inviterNameOrEmail}</strong> wants to connect with you as <strong>${args.relationship}</strong>.</p>
        <p>Open HealthConnect to review and accept the request.</p>
        <p>
          <a href="${joinUrl}" 
             style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">
             Open HealthConnect
          </a>
        </p>
        <p>If the button doesn't work, paste this link into your browser:<br/>
          <a href="${joinUrl}">${joinUrl}</a>
        </p>
      </div>
    `;

    const payload: ResendEmailPayload = {
      from: "HealthConnect <no-reply@healthconnect.local>",
      to: [args.toEmail],
      subject,
      html,
    };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Resend email error:", res.status, text);
      return;
    }

    return;
  },
});
