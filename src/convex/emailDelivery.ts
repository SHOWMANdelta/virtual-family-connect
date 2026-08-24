/**
 * Outbound email delivery.
 *
 * Rendering lives in ./emailTemplates; this file is only concerned with getting
 * a rendered message to an inbox. Everything goes over plain `fetch`, so no npm
 * SDK is needed and this runs in Convex's default (non-Node) runtime — which
 * matters, because this module is pulled into auth.ts via auth/emailOtp.ts.
 *
 * ## Reaching arbitrary recipients
 *
 * The important constraint, and the reason this file has two providers: proving
 * you control the address you send *from* is what authorises you to mail
 * strangers, and the two providers grant that at different granularities.
 *
 * Brevo verifies **individual addresses**, so a Gmail account you already own is
 * enough. Resend authorises **per domain** — its shared `onboarding@resend.dev`
 * sender only ever reaches the address that owns the Resend account, and there is
 * no single-sender or hosted-subdomain escape hatch. So:
 *
 *   - BREVO_API_KEY + EMAIL_FROM on a verified *sender* → mail to anyone,
 *     without owning a domain. This is the default and the recommended path.
 *   - RESEND_API_KEY + EMAIL_FROM on a DNS-verified domain → mail to anyone,
 *     with better long-term deliverability (DKIM can actually align).
 *   - RESEND_API_KEY alone                              → mail to yourself only.
 *
 * `sandboxed` on the resolved config captures that last, awkward case so the UI
 * can warn instead of silently failing for every recipient but one. Brevo has no
 * equivalent state that is detectable from configuration alone: an unverified
 * Brevo sender looks fine here and fails at send time, where `classify()` turns it
 * into EMAIL_SENDER_UNVERIFIED. Run `pnpm check:email` to settle it up front.
 *
 * ## Failure handling
 *
 * Delivery is retried only for genuinely transient failures, and every attempt
 * carries the same idempotency key so a retried 5xx can't send twice. Callers
 * get an `EmailDeliveryError` carrying a structured `code` (for user-facing
 * copy) and `operatorDetail` (the provider's own words, for the logs only —
 * `auth.signIn` is a public endpoint, so vendor text must not reach the client).
 */

import { subjectSafe } from "./emailTemplates";

const DEFAULT_RESEND_SENDER = "HealthConnect <onboarding@resend.dev>";

/** Wall-clock ceiling for one HTTP attempt. */
const ATTEMPT_TIMEOUT_MS = 10_000;

/**
 * Attempts per send, including the first. A sign-in code is awaited by a person
 * watching a spinner, so the budget below is deliberately small.
 */
const MAX_ATTEMPTS = 3;

/** Backoff before attempt 2 and attempt 3. */
const BACKOFF_MS = [500, 1_500];

/**
 * Longest provider-requested delay we'll actually wait out. A `retry-after`
 * beyond this means the window is too far off to be worth a person waiting, so
 * we stop and report a temporary failure instead.
 */
const MAX_HONOURED_RETRY_AFTER_MS = 3_000;

export type EmailProviderName = "resend" | "brevo";

export type EmailSender = { name: string; email: string };

export type ResolvedEmailConfig =
  | {
      configured: true;
      provider: EmailProviderName;
      apiKey: string;
      sender: EmailSender;
      /**
       * True when the sender address can only reach the provider account's own
       * owner — i.e. Resend's shared test domain. Sends to anyone else will be
       * rejected.
       */
      sandboxed: boolean;
    }
  | {
      configured: false;
      reason: "no_api_key" | "sender_required";
      /** Whether the console fallback is explicitly enabled (EMAIL_DEV_LOG). */
      devLog: boolean;
    };

/** Structured reasons a send failed, mapped to user-facing copy in src/lib/errors.ts. */
export type EmailErrorCode =
  | "EMAIL_NOT_CONFIGURED"
  | "EMAIL_SENDER_UNVERIFIED"
  | "EMAIL_QUOTA_EXCEEDED"
  | "EMAIL_AUTH_FAILED"
  | "EMAIL_REJECTED"
  | "EMAIL_TEMPORARY_FAILURE";

export class EmailDeliveryError extends Error {
  readonly code: EmailErrorCode;
  /** Whether retrying later could plausibly succeed. */
  readonly transient: boolean;
  /** The provider's own wording. For logs only — never send this to a client. */
  readonly operatorDetail: string;
  readonly status?: number;

  constructor(options: {
    code: EmailErrorCode;
    transient: boolean;
    operatorDetail: string;
    status?: number;
  }) {
    // The Error message is what lands in logs; it's the operator view.
    super(`${options.code}: ${options.operatorDetail}`);
    this.name = "EmailDeliveryError";
    this.code = options.code;
    this.transient = options.transient;
    this.operatorDetail = options.operatorDetail;
    this.status = options.status;
  }
}

export type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Short label for log lines, e.g. "sign-in code" or "room invite". */
  kind: string;
  /**
   * Set for messages whose body contains a credential. Adds a warning to the
   * console fallback; the body is still printed, because reading the code out of
   * the log is the entire point of that fallback.
   */
  sensitive?: boolean;
};

export type SendEmailResult =
  | { delivered: true; provider: EmailProviderName; id?: string }
  | { delivered: false; skipped: "logged_to_console" };

/**
 * Split `Name <addr@example.com>` or a bare `addr@example.com`.
 *
 * Returns null for anything without an `@`, so a typo'd EMAIL_FROM surfaces as a
 * configuration error rather than a confusing provider rejection.
 */
function parseSender(raw: string, fallbackName: string): EmailSender | null {
  const value = raw.trim();
  const angled = value.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>$/);

  if (angled) {
    // Display names may be quoted; strip the quotes but keep inner spacing.
    const name = angled[1]!.trim().replace(/^"(.*)"$/, "$1").trim();
    return { name: name || fallbackName, email: angled[2]!.trim() };
  }

  if (/^[^<>\s]+@[^<>\s]+$/.test(value)) {
    return { name: fallbackName, email: value };
  }

  return null;
}

/** Read an env var, treating blank as absent. */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Work out how (and whether) this deployment can send mail.
 *
 * Exported so the login page can show an accurate notice — checking only for the
 * presence of an API key would report "delivery configured" in the single most
 * likely broken state, a Resend key with no verified sender.
 */
export function resolveEmailConfig(): ResolvedEmailConfig {
  const devLog = env("EMAIL_DEV_LOG") === "true";

  // AUTH_RESEND_KEY is the name Convex Auth's own Resend provider uses; accept
  // it so an existing deployment doesn't have to be re-keyed.
  const resendKey = env("RESEND_API_KEY") ?? env("AUTH_RESEND_KEY");
  const brevoKey = env("BREVO_API_KEY");
  const forced = env("EMAIL_PROVIDER")?.toLowerCase();

  let provider: EmailProviderName | undefined;
  let apiKey: string | undefined;

  if (forced === "resend" || forced === "brevo") {
    provider = forced;
    apiKey = forced === "resend" ? resendKey : brevoKey;
  } else if (brevoKey) {
    // Brevo wins a tie deliberately. If both keys are present the Resend one is
    // most likely the leftover scaffolding key with no verified domain behind it,
    // which reaches exactly one inbox — so preferring it would silently break
    // sign-in for every user but the account owner. Set EMAIL_PROVIDER=resend
    // once that domain is actually verified.
    provider = "brevo";
    apiKey = brevoKey;
  } else if (resendKey) {
    provider = "resend";
    apiKey = resendKey;
  }

  if (!provider || !apiKey) {
    return { configured: false, reason: "no_api_key", devLog };
  }

  const fromRaw = env("EMAIL_FROM");

  // Resend has a usable default (its shared test sender); Brevo has none, since
  // every Brevo sender must be verified individually.
  if (!fromRaw && provider === "brevo") {
    return { configured: false, reason: "sender_required", devLog };
  }

  const sender = parseSender(fromRaw ?? DEFAULT_RESEND_SENDER, "HealthConnect");
  if (!sender) {
    return { configured: false, reason: "sender_required", devLog };
  }

  return {
    configured: true,
    provider,
    apiKey,
    sender,
    // Resend's test domain reaches the account owner and nobody else.
    sandboxed:
      provider === "resend" && sender.email.toLowerCase().endsWith("@resend.dev"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** RFC 4122 v4 UUID from the runtime's CSPRNG. */
function uuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * How long the provider asked us to wait, in ms, or null if it didn't say.
 *
 * Header names are matched case-insensitively by `Headers.get`; Resend documents
 * `retry-after` (seconds) and also returns `ratelimit-reset`.
 */
function retryAfterMs(response: Response): number | null {
  for (const header of ["retry-after", "ratelimit-reset"]) {
    const raw = response.headers.get(header);
    if (raw === null) continue;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  return null;
}

type ProviderError = { message: string; name?: string };

/**
 * Pull a human-readable message out of an error body.
 *
 * Resend's error shape isn't published in its docs (it is `{message, statusCode,
 * name}` in practice, per its own SDK types), and Brevo uses `{code, message}`.
 * Both are parsed defensively: any field may be missing, and the body may not be
 * JSON at all, so nothing here is allowed to throw.
 */
async function readProviderError(response: Response): Promise<ProviderError> {
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    return { message: `HTTP ${response.status} (body unreadable)` };
  }

  try {
    const parsed = JSON.parse(raw) as {
      message?: unknown;
      name?: unknown;
      code?: unknown;
      error?: unknown;
    };
    const message =
      typeof parsed.message === "string" && parsed.message !== ""
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : raw;
    const name =
      typeof parsed.name === "string"
        ? parsed.name
        : typeof parsed.code === "string"
          ? parsed.code
          : undefined;
    return { message: message || `HTTP ${response.status}`, name };
  } catch {
    return { message: raw.slice(0, 400) || `HTTP ${response.status}` };
  }
}

/**
 * Turn a provider rejection into a structured error.
 *
 * Control flow keys off the HTTP status, which both providers document, rather
 * than the error `name`, which they don't: Resend reuses `validation_error`
 * across a 400 and three different 403s, so the name alone can't tell an
 * unverified domain from a suspended key. Message substrings disambiguate only
 * where the status can't.
 */
function classify(
  status: number,
  error: ProviderError,
  provider: EmailProviderName,
): EmailDeliveryError {
  const detail = `${provider} ${status}${error.name ? ` ${error.name}` : ""}: ${error.message}`;
  const message = error.message.toLowerCase();

  // "This sender isn't allowed to mail this recipient" — the most likely
  // misconfiguration by far, and the one worth naming precisely, because the
  // catch-all at the bottom of this function blames the *recipient's* address
  // instead and sends the operator hunting for a typo that isn't there.
  //
  // Providers disagree on the status: Resend uses 403, Brevo a 400-class
  // `invalid_parameter`. Gating on 403 alone classified every unverified Brevo
  // sender as EMAIL_REJECTED — on precisely the path recommended to people who
  // don't own a domain.
  const senderProblem =
    // Resend: shared test domain, or a `from` domain still awaiting DNS.
    message.includes("you can only send testing emails") ||
    message.includes("not verified") ||
    message.includes("domain is not verified") ||
    // Brevo's wording varies ("Sender is not valid", "sender email is not
    // registered"), so pair a mention of the sender with a rejection word rather
    // than guessing the exact sentence. A rejected *recipient* never mentions
    // the sender, so this can't swallow one.
    (message.includes("sender") &&
      /\b(not|invalid|unknown|unrecognized|unauthorized)\b/.test(message)) ||
    error.name === "invalid_from_address";

  if (senderProblem && (status === 403 || status === 400 || status === 422)) {
    return new EmailDeliveryError({
      code: "EMAIL_SENDER_UNVERIFIED",
      transient: false,
      operatorDetail: detail,
      status,
    });
  }

  if (status === 401 || status === 403) {
    return new EmailDeliveryError({
      code: "EMAIL_AUTH_FAILED",
      transient: false,
      operatorDetail: detail,
      status,
    });
  }

  if (status === 429) {
    // A 429 is not always a rate limit — Resend also returns it for daily and
    // monthly quota exhaustion, which no amount of backoff will clear.
    const quotaExhausted =
      error.name === "daily_quota_exceeded" ||
      error.name === "monthly_quota_exceeded" ||
      message.includes("quota") ||
      message.includes("credit"); // Brevo: "not enough credits"

    return new EmailDeliveryError({
      code: quotaExhausted ? "EMAIL_QUOTA_EXCEEDED" : "EMAIL_TEMPORARY_FAILURE",
      transient: !quotaExhausted,
      operatorDetail: detail,
      status,
    });
  }

  if (status >= 500) {
    return new EmailDeliveryError({
      code: "EMAIL_TEMPORARY_FAILURE",
      transient: true,
      operatorDetail: detail,
      status,
    });
  }

  // 400/404/405/422 and anything else: the request itself is wrong. Most often a
  // recipient address the provider won't accept.
  return new EmailDeliveryError({
    code: "EMAIL_REJECTED",
    transient: false,
    operatorDetail: detail,
    status,
  });
}

type Attempt =
  | { ok: true; id?: string }
  | { ok: false; error: EmailDeliveryError; retryAfter: number | null };

async function attempt(
  config: Extract<ResolvedEmailConfig, { configured: true }>,
  args: SendEmailArgs,
  idempotencyKey: string,
): Promise<Attempt> {
  const { provider, apiKey, sender } = config;

  // Re-applied here rather than trusted from the caller: this is the one place
  // every outbound message passes through, so a template that forgets to
  // sanitize its subject still can't put a control character in a header.
  const subject = subjectSafe(args.subject);

  const url =
    provider === "resend"
      ? "https://api.resend.com/emails"
      : "https://api.brevo.com/v3/smtp/email";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    // Convex already sends `Convex/1.0`, which satisfies Resend's requirement
    // that a User-Agent be present (it rejects requests without one at the edge
    // with a 403/1010 that looks exactly like a bad key). An explicit, specific
    // value just makes the provider's logs easier to read.
    "User-Agent": "HealthConnect/1.0 (+convex)",
  };

  const body =
    provider === "resend"
      ? {
          from: `${sender.name} <${sender.email}>`,
          to: [args.to],
          subject,
          html: args.html,
          text: args.text,
        }
      : {
          sender: { name: sender.name, email: sender.email },
          to: [{ email: args.to }],
          subject,
          htmlContent: args.html,
          textContent: args.text,
        };

  if (provider === "resend") {
    headers.Authorization = `Bearer ${apiKey}`;
    // Lets us retry a 5xx without risking a duplicate: Resend replays the stored
    // response for 24h instead of sending again.
    headers["Idempotency-Key"] = idempotencyKey;
  } else {
    headers["api-key"] = apiKey;
    // Brevo has no idempotency header, so a 5xx that actually sent could produce
    // a second code on retry. Left as-is: the retry budget is 3, both codes would
    // be for the same sign-in attempt, and Convex Auth only honours the newest —
    // so the worst case is a duplicate email, not a broken or leaked login.
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
  } catch (caught) {
    // Timeout or transport failure. Convex surfaces an aborted fetch as a plain
    // Error rather than a DOMException named AbortError, so there's nothing
    // reliable to sniff — and it doesn't matter, since both are transient.
    const reason = caught instanceof Error ? caught.message : String(caught);
    return {
      ok: false,
      retryAfter: null,
      error: new EmailDeliveryError({
        code: "EMAIL_TEMPORARY_FAILURE",
        transient: true,
        operatorDetail: `${provider} request failed or timed out: ${reason}`,
      }),
    };
  }

  if (response.ok) {
    let id: string | undefined;
    try {
      const parsed = (await response.json()) as {
        id?: unknown;
        messageId?: unknown;
      };
      const raw = parsed.id ?? parsed.messageId;
      if (typeof raw === "string") id = raw;
    } catch {
      // A success with an unparseable body is still a success.
    }
    return { ok: true, id };
  }

  const providerError = await readProviderError(response);
  return {
    ok: false,
    retryAfter: retryAfterMs(response),
    error: classify(response.status, providerError, provider),
  };
}

/**
 * Send one email.
 *
 * Throws `EmailDeliveryError` when the message could not be handed to the
 * provider. Resolves with `skipped` when no provider is configured *and* the
 * console fallback has been explicitly enabled — see EMAIL_DEV_LOG below.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const config = resolveEmailConfig();

  if (!config.configured) {
    // Fail closed by default. This used to log-and-continue unconditionally,
    // which is convenient locally but means a production deploy that forgets the
    // key silently writes every sign-in code to its log stream while telling
    // users a code was sent. Opting in with EMAIL_DEV_LOG=true keeps local
    // development key-free without that being the default.
    if (!config.devLog) {
      throw new EmailDeliveryError({
        code: "EMAIL_NOT_CONFIGURED",
        transient: false,
        operatorDetail:
          config.reason === "sender_required"
            ? "EMAIL_FROM is missing or malformed (expected `Name <you@example.com>`)."
            : "No email provider key is set. Set BREVO_API_KEY (or RESEND_API_KEY), or set EMAIL_DEV_LOG=true to log messages to the console instead.",
      });
    }

    console.warn(
      [
        "",
        "==================================================================",
        ` EMAIL NOT SENT (${args.kind}) — no provider configured.`,
        ` To: ${args.to}`,
        ` Subject: ${subjectSafe(args.subject)}`,
        ...(args.sensitive
          ? [
              " !! This message contains a working credential. EMAIL_DEV_LOG",
              " !! must never be set on a deployment whose logs others can read.",
            ]
          : []),
        "------------------------------------------------------------------",
        args.text,
        "------------------------------------------------------------------",
        " To deliver for real — Brevo verifies a single address, so no domain",
        " is needed. Confirm the sender in Brevo under Senders first, then:",
        "   npx convex env set BREVO_API_KEY xkeysib-xxxxxxxx",
        '   npx convex env set EMAIL_FROM "HealthConnect <you@gmail.com>"',
        "   pnpm check:email        # confirms the sender is actually verified",
        "==================================================================",
        "",
      ].join("\n"),
    );
    return { delivered: false, skipped: "logged_to_console" };
  }

  // Reused across retries so a retried 5xx can't produce a second email.
  const idempotencyKey = uuid();
  let lastError: EmailDeliveryError | undefined;

  for (let index = 0; index < MAX_ATTEMPTS; index++) {
    const result = await attempt(config, args, idempotencyKey);
    if (result.ok) {
      return { delivered: true, provider: config.provider, id: result.id };
    }

    lastError = result.error;
    if (!result.error.transient) break;

    const isLastAttempt = index === MAX_ATTEMPTS - 1;
    if (isLastAttempt) break;

    const requested = result.retryAfter;
    if (requested !== null && requested > MAX_HONOURED_RETRY_AFTER_MS) {
      // The provider wants us to wait longer than someone will sit through.
      break;
    }

    // `Math.max`, not `requested ?? backoff`: `??` only falls through on
    // null/undefined, and `ratelimit-reset` is legitimately `0` in the last
    // fraction of a rate-limit window. A literal 0 would sleep no time at all
    // and burn all three attempts within a few milliseconds.
    await sleep(Math.max(requested ?? 0, BACKOFF_MS[index] ?? 1_500));
  }

  throw (
    lastError ??
    new EmailDeliveryError({
      code: "EMAIL_TEMPORARY_FAILURE",
      transient: true,
      operatorDetail: "Delivery failed for an unknown reason.",
    })
  );
}
