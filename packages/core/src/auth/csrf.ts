import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Centralized CSRF protection (baseline #5). Tokens are HMAC-bound to the
 * session id AND to an issue timestamp, so they cannot be forged, replayed
 * across sessions, or used indefinitely. The HTTP middleware (and the plugin
 * SDK) call `verify` on every mutation — plugin authors cannot opt out.
 */
export interface CsrfProtection {
  issue(sessionId: string): string;
  verify(sessionId: string, token: string): boolean;
}

export interface CsrfOptions {
    /** Token lifetime in ms. Defaults to 12h. */
    ttlMs?: number;
    now?: () => number;
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

function sign(secret: Buffer, sessionId: string, nonce: string, issuedAt: number): string {
    return createHmac("sha256", secret).update(`${sessionId}.${nonce}.${issuedAt}`).digest("base64url");
}

export function createCsrf(secret: Buffer, opts: CsrfOptions = {}): CsrfProtection {
    const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    const now = opts.now ?? (() => Date.now());
  return {
    issue(sessionId) {
      const nonce = randomBytes(16).toString("base64url");
        const issuedAt = now();
        return `${nonce}.${issuedAt}.${sign(secret, sessionId, nonce, issuedAt)}`;
    },
    verify(sessionId, token) {
        const parts = token.split(".");
        if (parts.length !== 3) return false;
        const [nonce, issuedAtRaw, mac] = parts;
        const issuedAt = Number(issuedAtRaw);
        if (!Number.isFinite(issuedAt)) return false;
        // Reject expired (and clock-skewed future) tokens before the HMAC check.
        const age = now() - issuedAt;
        if (age < 0 || age > ttlMs) return false;
        const expected = sign(secret, sessionId, nonce!, issuedAt);
        const provided = Buffer.from(mac!);
      const wanted = Buffer.from(expected);
      if (provided.length !== wanted.length) return false;
      return timingSafeEqual(provided, wanted);
    },
  };
}
