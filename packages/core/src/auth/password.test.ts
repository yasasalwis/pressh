import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@pressh/core";

describe("password hashing", () => {
  it("hashes with argon2id and verifies the correct password", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("returns false (not throws) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});
