/**
 * Email rendering. Delivery lives in ./emailDelivery.
 *
 * Both templates interpolate user-supplied text (room names, display names,
 * personal notes), so everything reaching the HTML goes through `escapeHtml` and
 * everything reaching a subject line goes through `subjectSafe`.
 */

const BRAND_NAME = "HealthConnect";
const ACCENT = "#2563eb";

/**
 * Flatten a string for use as a header value, and cap its length.
 *
 * Subject lines carry user-supplied text (a room name, a display name). The
 * provider takes JSON rather than raw SMTP, so a stray CRLF here is very
 * unlikely to become header injection — but the point of a header-injection
 * guard is not to depend on someone else's escaping. Control characters also
 * render as mojibake in most clients, so dropping them is a win regardless.
 *
 * Applied again inside `sendEmail`, so a new template can't forget it.
 */
export function subjectSafe(value: string, maxLength = 120): string {
  // Done by code point rather than by regex: the C0/C1 ranges are exactly the
  // characters that are awkward to write safely in a source literal.
  let cleaned = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    cleaned += isControl ? " " : char;
  }

  const flattened = cleaned.replace(/\s+/g, " ").trim();
  return flattened.length > maxLength
    ? `${flattened.slice(0, maxLength - 1)}…`
    : flattened;
}

/** Escape untrusted text before interpolating it into an HTML email. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(options: {
  heading: string;
  bodyHtml: string;
  footerNote?: string;
}): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.12);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td style="background:${ACCENT};padding:20px 32px;">
                <span style="color:#ffffff;font-size:17px;font-weight:600;letter-spacing:0.2px;">${BRAND_NAME}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;font-weight:600;">${options.heading}</h1>
                ${options.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">
                  ${options.footerNote ?? `Sent by ${BRAND_NAME}.`}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buttonHtml(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
    <tr>
      <td style="border-radius:10px;background:${ACCENT};">
        <a href="${escapeHtml(url)}"
           style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

/** Sign-in one-time code. */
export function renderOtpEmail(code: string, expiryMinutes: number) {
  const spaced = code.split("").join(" ");
  return {
    // The code is deliberately NOT in the subject. Subject lines show up in
    // lock-screen notifications and email-client previews, which is exactly
    // where a bystander can read a credential off a phone without unlocking it.
    subject: `Your ${BRAND_NAME} sign-in code`,
    html: layout({
      heading: "Your sign-in code",
      bodyHtml: `
        <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#475569;">
          Enter this code to finish signing in:
        </p>
        <div style="margin:24px 0;padding:20px;background:#f1f5f9;border-radius:12px;text-align:center;">
          <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#0f172a;">${spaced}</span>
        </div>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#64748b;">
          The code expires in ${expiryMinutes} minutes and can only be used once.
        </p>`,
      footerNote: `If you didn't try to sign in to ${BRAND_NAME}, you can safely ignore this email — nobody can access your account with just this message.`,
    }),
    text: [
      `Your ${BRAND_NAME} sign-in code is: ${code}`,
      "",
      `It expires in ${expiryMinutes} minutes and can only be used once.`,
      "",
      "If you didn't try to sign in, you can ignore this email.",
    ].join("\n"),
  };
}

/** Direct "join this video call" invitation. */
export function renderRoomInviteEmail(options: {
  joinUrl: string;
  roomName: string;
  inviterName: string;
  /** Pre-formatted, e.g. "28 minutes" or "24 hours". */
  expiresInLabel: string;
  personalNote?: string;
}) {
  const roomName = escapeHtml(options.roomName);
  const inviterName = escapeHtml(options.inviterName);
  const note = options.personalNote?.trim();

  return {
    subject: subjectSafe(
      `${options.inviterName} invited you to join "${options.roomName}"`,
    ),
    html: layout({
      heading: `${inviterName} invited you to a video call`,
      bodyHtml: `
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569;">
          You've been invited to join <strong style="color:#0f172a;">${roomName}</strong>.
          Click below to accept and go straight into the call — no account setup required,
          you can join as a guest.
        </p>
        ${
          note
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
                 <tr>
                   <td style="padding:14px 16px;background:#f8fafc;border-left:3px solid ${ACCENT};border-radius:6px;">
                     <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;font-style:italic;">"${escapeHtml(note)}"</p>
                   </td>
                 </tr>
               </table>`
            : ""
        }
        ${buttonHtml(options.joinUrl, "Join the call")}
        <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#64748b;">
          If the button doesn't work, copy this link into your browser:
        </p>
        <p style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;">
          <a href="${escapeHtml(options.joinUrl)}" style="color:${ACCENT};">${escapeHtml(options.joinUrl)}</a>
        </p>`,
      footerNote: `This invitation link expires in ${options.expiresInLabel}. If you weren't expecting it, you can ignore this email.`,
    }),
    text: [
      `${options.inviterName} invited you to join the video call "${options.roomName}".`,
      ...(note ? ["", `Their note: "${note}"`] : []),
      "",
      "Join here:",
      options.joinUrl,
      "",
      `This link expires in ${options.expiresInLabel}. You can join as a guest — no account needed.`,
    ].join("\n"),
  };
}
