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
});
