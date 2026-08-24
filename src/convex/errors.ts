import { ConvexError } from "convex/values";

/**
 * A failure with a machine-readable code and copy meant for a person to read.
 *
 * Extends `ConvexError`, not `Error`, and that is the whole point. A production
 * Convex deployment strips the message off any ordinary thrown `Error` — the
 * client receives a bare `Server Error` — precisely so that internal detail and
 * stack traces can't leak to callers. Only a `ConvexError`'s `data` is delivered
 * intact.
 *
 * So every code below (`ROOM_EXPIRED`, `INVITE_EXPIRED`, `OTP_RATE_LIMITED`, …)
 * was invisible in production while this threw a plain `Error`: locally you saw
 * "This invitation has expired", and on the deployed site the same failure showed
 * a generic fallback. These messages are *written to be read by the person who
 * hit them*, so sending them is intended — but that makes it a rule for what may
 * be thrown this way: user-facing copy only, never provider responses, internal
 * identifiers, or anything about why the server is unhappy.
 */
export class ApiError extends ConvexError<string> {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number = 400) {
    // The `CODE: message` shape is the wire format the client's parser expects.
    // Passing a string means `data` and `message` are both set to it.
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status;
    // Maintains proper stack for where our error was thrown.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
    this.name = "ApiError";
  }
}

/**
 * Helper to throw a structured API error.
 */
export const throwErr = (code: string, message: string, status: number = 400): never => {
  throw new ApiError(code, message, status);
};

/**
 * Safe parsing of unknown errors into a consistent shape.
 * Useful for logging or HTTP responses if needed.
 */
export const parseError = (err: unknown): { code: string; message: string; status: number } => {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/^([A-Z_]+):\s*(.*)$/);
  if (match) {
    const code = match[1] ?? "UNKNOWN";
    const message = match[2] ?? raw;
    return { code, message, status: 400 };
  }
  return { code: "UNKNOWN", message: raw, status: 400 };
};