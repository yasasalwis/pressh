import { pino } from "pino";
import type { Logger as PinoLogger } from "pino";

/**
 * Keys whose values are redacted before logging (baseline #6). Matched
 * case-insensitively against object keys at any depth.
 */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "apikey",
  "authorization",
  "cookie",
  "sessionid",
  "masterkey",
  "privatekey",
  "pressh_master_key",
]);

const REDACTED = "[REDACTED]";

/**
 * Deep-redacts a value: any object key matching `sensitive` (case-insensitive)
 * has its value replaced. Cycle-safe. Used by the logger and reused by the
 * audit log so the same fields are protected everywhere.
 */
export function redactDeep(
  value: unknown,
  sensitive: ReadonlySet<string> = SENSITIVE_KEYS,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, sensitive, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = sensitive.has(key.toLowerCase()) ? REDACTED : redactDeep(val, sensitive, seen);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: string;
  sensitiveKeys?: ReadonlySet<string>;
  pino?: PinoLogger;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const sensitive = opts.sensitiveKeys ?? SENSITIVE_KEYS;
  const base = opts.pino ?? pino({ level: opts.level ?? "info" });

  const wrap = (instance: PinoLogger): Logger => ({
    debug: (msg, fields) => instance.debug(redactDeep(fields ?? {}, sensitive) as object, msg),
    info: (msg, fields) => instance.info(redactDeep(fields ?? {}, sensitive) as object, msg),
    warn: (msg, fields) => instance.warn(redactDeep(fields ?? {}, sensitive) as object, msg),
    error: (msg, fields) => instance.error(redactDeep(fields ?? {}, sensitive) as object, msg),
    child: (bindings) => wrap(instance.child(redactDeep(bindings, sensitive) as object)),
  });

  return wrap(base);
}
