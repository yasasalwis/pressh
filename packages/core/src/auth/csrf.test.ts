import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { createCsrf } from "@pressh/core";

describe("CSRF protection", () => {
  const csrf = createCsrf(randomBytes(32));

  it("verifies a token it issued for the same session", () => {
    const token = csrf.issue("session-1");
    expect(csrf.verify("session-1", token)).toBe(true);
  });

  it("rejects a token for a different session", () => {
    const token = csrf.issue("session-1");
    expect(csrf.verify("session-2", token)).toBe(false);
  });

  it("rejects a tampered token", () => {
    const token = csrf.issue("session-1");
    expect(csrf.verify("session-1", `${token}x`)).toBe(false);
  });

  it("rejects a malformed token", () => {
    expect(csrf.verify("session-1", "no-dot-here")).toBe(false);
  });

    it("rejects an expired token (TTL) but accepts it within the window", () => {
        let clock = 1_000_000;
        const ttlCsrf = createCsrf(randomBytes(32), {ttlMs: 1000, now: () => clock});
        const token = ttlCsrf.issue("session-1");
        expect(ttlCsrf.verify("session-1", token)).toBe(true);
        clock += 999;
        expect(ttlCsrf.verify("session-1", token)).toBe(true); // still inside window
        clock += 2;
        expect(ttlCsrf.verify("session-1", token)).toBe(false); // expired
    });

    it("rejects a token whose timestamp was tampered to extend its life", () => {
        const clock = 1_000_000;
        const ttlCsrf = createCsrf(randomBytes(32), {ttlMs: 1000, now: () => clock});
        const token = ttlCsrf.issue("session-1");
        const [nonce, , mac] = token.split(".");
        // Forge a far-future issuedAt to dodge expiry — the HMAC no longer matches.
        const forged = `${nonce}.${clock + 9_000_000}.${mac}`;
        expect(ttlCsrf.verify("session-1", forged)).toBe(false);
    });
});
