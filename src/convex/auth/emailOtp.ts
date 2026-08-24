import { Email } from "@convex-dev/auth/providers/Email";
import type { GenericActionCtx } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { EmailDeliveryError, sendEmail } from "../emailDelivery";
import { renderOtpEmail } from "../emailTemplates";
import { ApiError } from "../errors";

const EXPIRY_MINUTES = 15;
const CODE_LENGTH = 6;

/**
 * Cryptographically random numeric string.
 *
 * Uses rejection sampling (discarding bytes >= 250) so every digit is equally
 * likely — a plain `byte % 10` would bias digits 0-5.
 */
function randomNumericCode(length: number): string {
  const buffer = new Uint8Array(1);
  let code = "";
  while (code.length < length) {
    crypto.getRandomValues(buffer);
    const byte = buffer[0]!;
    if (byte < 250) {
      code += (byte % 10).toString();
    }
  }
  return code;
}

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * EXPIRY_MINUTES,

  generateVerificationToken() {
    return randomNumericCode(CODE_LENGTH);
  },

  /**
   * `...rest` is where the Convex action ctx arrives.
   *
   * Auth.js types this callback as taking a single params object, but Convex Auth
   * calls it with `(params, ctx)` — it just suppresses the resulting type error
   * on its own side. Declaring a rest parameter lets us reach the ctx (needed
   * for the rate-limit check, which requires database access) while keeping this
   * function assignable to the one-parameter type Auth.js expects. A cast would
   * work too, but would silently break if the runtime signature ever changed.
   */
  async sendVerificationRequest(
    { identifier: email, token },
    ...rest: unknown[]
  ) {
    const ctx = rest[0] as GenericActionCtx<DataModel> | undefined;

    // Throttle before doing any work. `auth.signIn` is public and
    // unauthenticated, so this is the only thing standing between a `for` loop
    // and a stranger's inbox filling up with codes from our sending domain.
    // Rate-limit rejections are allowed to propagate: their messages are ours,
    // already carry a structured code, and telling the user how long to wait is
    // the entire point.
    if (ctx) {
      await ctx.runMutation(internal.rateLimit.consumeOtpSend, { email });
    } else {
      // Never expected. Fail loudly rather than silently dropping the limit —
      // an unthrottled public mailer is worse than a broken sign-in button.
      throw new ApiError(
        "OTP_SEND_FAILED",
        "Sign-in is misconfigured on this server (no request context).",
      );
    }

    const { subject, html, text } = renderOtpEmail(token, EXPIRY_MINUTES);

    try {
      await sendEmail({
        to: email,
        subject,
        html,
        text,
        kind: "sign-in code",
        // Adds a "this is a credential" warning to the dev console fallback.
        sensitive: true,
      });
    } catch (error) {
      // The full provider text goes to the log, where an operator can act on it.
      const detail =
        error instanceof EmailDeliveryError
          ? error.operatorDetail
          : error instanceof Error
            ? error.message
            : String(error);
      console.error(`Failed to send sign-in code to ${email}: ${detail}`);

      // What goes back to the browser is only our own structured code. This
      // endpoint is reachable by anyone, so the provider's wording — which can
      // name the account owner's email address, the sending domain, or quota
      // state — must not travel with it. src/lib/errors.ts turns the code into
      // the sentence the user reads.
      const code =
        error instanceof EmailDeliveryError ? error.code : "EMAIL_SEND_FAILED";
      throw new ApiError(code, "We couldn't send your sign-in code.");
    }
  },
});
