/**
 * Turning Convex errors into something a person can read.
 *
 * Convex wraps a thrown server error into a multi-line message that looks like:
 *
 *   [CONVEX M(rooms:joinRoom)] [Request ID: 7f3a] Server Error
 *   Uncaught ApiError: ROOM_EXPIRED: Room has expired
 *       at handler (../convex/rooms.ts:88:7)
 *
 * A regex anchored with `^` never matches that, which is why raw Convex noise
 * was leaking into toasts. These helpers dig the real `CODE: message` back out
 * and fall back to a clean single line when there is no structured code.
 */

export type ApiErrorInfo = {
  code: string;
  message: string;
};

/** Structured codes thrown by our Convex functions, mapped to plain English. */
const CODE_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in to continue.",
  ROOM_NOT_FOUND: "That call no longer exists.",
  ROOM_EXPIRED: "This call has already ended.",
  ROOM_INACTIVE: "This call is no longer active.",
  ROOM_AT_CAPACITY: "This call is full.",
  INVALID_EMAIL: "Please enter a valid email address.",
  INVALID_ROOM_NAME: "Room name must be at least 2 characters.",
  INVALID_CAPACITY: "Choose a capacity between 2 and 50 participants.",
  CANNOT_INVITE_SELF: "That's your own address — invite someone else.",
  ALREADY_IN_ROOM: "You're already in this call.",
  INVITE_NOT_FOUND: "This invitation link isn't valid.",
  INVITE_EXPIRED: "This invitation has expired. Ask for a new one.",
  INVITE_REVOKED: "This invitation was cancelled.",
  INVITE_ALREADY_USED: "This invitation has already been used.",

  // Email delivery. The server deliberately sends only these codes — never the
  // email provider's own wording, which can name the account owner's address or
  // the sending domain, and reaches an unauthenticated caller on the sign-in
  // endpoint. Every message here offers a way forward, because in each case
  // guest sign-in still works.
  EMAIL_NOT_CONFIGURED:
    "This server can't send email yet, so we couldn't deliver your code. Continue as a guest, or ask the site admin to finish email setup.",
  EMAIL_SENDER_UNVERIFIED:
    "This server can't email that address yet — its sending address isn't verified. Continue as a guest, or ask the site admin to finish email setup.",
  EMAIL_QUOTA_EXCEEDED:
    "This server has sent as much email as it's allowed to for now. Try again later, or continue as a guest.",
  EMAIL_AUTH_FAILED:
    "This server's email credentials were rejected. Continue as a guest, or ask the site admin to check them.",
  EMAIL_REJECTED:
    "That address was rejected as undeliverable. Check it for typos and try again.",
  EMAIL_TEMPORARY_FAILURE:
    "We couldn't reach our email service just now. Please try again in a moment.",
  EMAIL_SEND_FAILED:
    "We couldn't send your sign-in code. Please try again in a moment.",
  OTP_SEND_FAILED:
    "Sign-in isn't configured correctly on this server. Continue as a guest, or contact the site admin.",
};

/**
 * Codes whose server-supplied message should be shown as-is.
 *
 * These carry detail that can't be written into static copy — chiefly how long
 * the caller has to wait — so overriding them with a fixed sentence would throw
 * away the only genuinely useful part.
 */
const PASSTHROUGH_CODES = new Set(["OTP_RATE_LIMITED", "INVITE_RATE_LIMITED"]);

/**
 * Auth-flow failures with no structured code.
 *
 * Convex Auth and the browser throw plain errors, so these match on fragments of
 * the underlying message. They are a fallback only: `parseAuthError` checks for
 * one of our own codes first, because a fuzzy pattern will happily swallow a
 * precise error — `/too many|rate.?limit/i` matching a message that already said
 * exactly what was wrong and how long to wait.
 */
const AUTH_ERROR_PATTERNS: Array<[RegExp, string]> = [
  [
    /Could not verify code|InvalidSecret|invalid.*code|verification.*failed/i,
    "That code isn't right, or it has expired. Request a new one.",
  ],
  [
    /too many|rate.?limit/i,
    "Too many attempts. Please wait a minute and try again.",
  ],
  [
    /JWT_PRIVATE_KEY|JWKS|Environment variable/i,
    "The server is missing its auth keys. Run `pnpm setup:auth`, then restart `convex dev`.",
  ],
  [
    /AUTH_GOOGLE_ID|AUTH_GOOGLE_SECRET|Missing.*client/i,
    "Google sign-in isn't configured on this server yet.",
  ],
  [
    /InvalidAccountId|account.*not found/i,
    "We couldn't find an account for that address.",
  ],
  [
    // Deliberately specific. A bare /network/i also matches ordinary sentences
    // containing the word, and told people to start a dev server that was
    // already running.
    /Failed to fetch|NetworkError|ERR_CONNECTION|ECONNREFUSED|WebSocket|Could not connect/i,
    "Can't reach the server. Make sure `npx convex dev` is running.",
  ],
];

function rawMessage(err: unknown): string {
  if (err === null || err === undefined) return "";
  // ConvexError carries a structured `data` payload.
  if (typeof err === "object" && "data" in err) {
    const data = (err as { data: unknown }).data;
    if (typeof data === "string" && data.length > 0) return data;
    if (data !== null && typeof data === "object" && "message" in data) {
      return String((data as { message: unknown }).message);
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Strip Convex's framing (`[CONVEX ...]`, `Server Error`, `Uncaught XyzError:`,
 * the trailing `Called by client`) and the stack trace, leaving the message the
 * server actually threw.
 *
 * Returns `""` when nothing survives, which is the normal case for a plain
 * `Error` thrown on a production deployment: the message is stripped server-side
 * and all that reaches us is framing. Callers must treat empty as "no
 * information" and use their own fallback — returning the framing itself put
 * "Called by client" in front of users on the deployed site.
 */
function stripConvexFraming(raw: string): string {
  const meaningful = raw
    .split("\n")
    .map((line) => line.trim())
    // Drop the transport header and the stack frames.
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("at ") &&
        !/^\[CONVEX\b/.test(line) &&
        !/^\[Request ID:/.test(line) &&
        line !== "Server Error" &&
        line !== "Uncaught Error" &&
        // Appended by the client when an action or mutation rejects. It describes
        // the call site, not the failure, and is never worth showing.
        line !== "Called by client",
    );

  const first = meaningful[0];
  if (first === undefined) return "";
  return first.replace(/^Uncaught\s+\w*Error:\s*/i, "").trim();
}

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * Pull the structured `CODE: message` out of a Convex error, preferring our own
 * mapped copy over the server's raw wording.
 */
export function parseApiError(err: unknown): ApiErrorInfo {
  const raw = rawMessage(err);
  if (!raw) {
    return { code: "UNKNOWN", message: GENERIC_MESSAGE };
  }

  const cleaned = stripConvexFraming(raw);
  // Framing only — a production deployment stripped the real message. There is
  // nothing here worth showing.
  if (!cleaned) {
    return { code: "UNKNOWN", message: GENERIC_MESSAGE };
  }

  const match = cleaned.match(/\b([A-Z][A-Z0-9_]{2,})\s*:\s*(.+)$/);

  if (match) {
    const code = match[1]!;
    return { code, message: CODE_MESSAGES[code] ?? match[2]!.trim() };
  }

  return { code: "UNKNOWN", message: cleaned };
}

/**
 * Best-effort human sentence for a sign-in failure. Falls back to the structured
 * parser, then to a generic line — never to raw JSON or a stack trace.
 */
export function parseAuthError(err: unknown, fallback: string): string {
  // Structured codes win. They come from our own code and say precisely what
  // happened; a fuzzy pattern reaching them first would replace an accurate,
  // actionable message with a vaguer guess.
  const { code, message } = parseApiError(err);
  if (code in CODE_MESSAGES || PASSTHROUGH_CODES.has(code)) {
    return message;
  }

  const raw = rawMessage(err);
  for (const [pattern, patternMessage] of AUTH_ERROR_PATTERNS) {
    if (pattern.test(raw)) return patternMessage;
  }

  // Nothing survived stripping, so the caller's fallback is strictly better than
  // ours: it knows which step failed and can say "that code isn't right" rather
  // than "something went wrong".
  if (message === GENERIC_MESSAGE) return fallback;

  // Anything left that still looks like machine output isn't worth showing.
  if (!message || message.length > 200 || /\{|\}|\bat\s+\S+:\d+/.test(message)) {
    return fallback;
  }
  return message;
}
