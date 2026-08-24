import { query } from "./_generated/server";
import { resolveEmailConfig } from "./emailDelivery";

/**
 * Which sign-in methods are actually usable on this deployment.
 *
 * The login page reads this so it can hide the Google button when no OAuth
 * credentials are configured, rather than showing a control that throws when
 * clicked.
 *
 * The email fields describe delivery honestly, because "an API key exists" and
 * "a code will reach the address you typed" are not the same thing — a Resend key
 * with no verified sending domain delivers to exactly one inbox and rejects
 * every other address. Reporting only key presence would show a green light in
 * the single most likely broken configuration.
 */
export const availableProviders = query({
  args: {},
  handler: async () => {
    const config = resolveEmailConfig();

    return {
      google: Boolean(
        process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
      ),
      emailOtp: true,
      guest: true,

      /** A provider is configured and will be called. */
      emailDelivery: config.configured,

      /**
       * Configured, but the sender can only reach the provider account's own
       * owner — Resend's shared test domain. Sign-in works for that one address
       * and fails for everyone else, so the UI needs to say so up front.
       */
      emailSandboxed: config.configured && config.sandboxed,

      /**
       * Nothing is configured *and* the console fallback is on, so codes are
       * being written to the server log. Only ever true in local development.
       */
      emailToConsole: !config.configured && config.devLog,
    };
  },
});
