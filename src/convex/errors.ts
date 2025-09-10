export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number = 400) {
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