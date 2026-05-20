/**
 * Typed error model. Every failure surfaces as a `PressError` with a stable
 * machine-readable `code` so callers (and the HTTP layer) can map to status
 * codes without string-matching messages. Messages and `detail` must never
 * contain secrets or PII (see baseline #6 redaction).
 */
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "capability_denied"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "internal";

export class PressError extends Error {
  readonly code: ErrorCode;
  readonly detail: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "PressError";
    this.code = code;
    this.detail = detail;
  }
}
