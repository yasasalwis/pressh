import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Centralized CSRF protection (baseline #5). Tokens are HMAC-bound to the
 * session id, so they cannot be forged or replayed across sessions. The HTTP
 * middleware (and the plugin SDK) call `verify` on every mutation — plugin
 * authors cannot opt out.
 */
export interface CsrfProtection {
  issue(sessionId: string): string;
  verify(sessionId: string, token: string): boolean;
}

function sign(secret: Buffer, sessionId: string, nonce: string): string {
  return createHmac("sha256", secret).update(`${sessionId}.${nonce}`).digest("base64url");
}

export function createCsrf(secret: Buffer): CsrfProtection {
  return {
    issue(sessionId) {
      const nonce = randomBytes(16).toString("base64url");
      return `${nonce}.${sign(secret, sessionId, nonce)}`;
    },
    verify(sessionId, token) {
      const dot = token.indexOf(".");
      if (dot < 0) return false;
      const nonce = token.slice(0, dot);
      const mac = token.slice(dot + 1);
      const expected = sign(secret, sessionId, nonce);
      const provided = Buffer.from(mac);
      const wanted = Buffer.from(expected);
      if (provided.length !== wanted.length) return false;
      return timingSafeEqual(provided, wanted);
    },
  };
}
