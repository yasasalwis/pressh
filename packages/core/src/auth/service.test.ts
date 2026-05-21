import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CapabilityGate,
  createAuthService,
  createFileAuditLog,
  createFileSystemStorage,
} from "@pressh/core";
import type { AuditLog, AuthService, StorageAdapter } from "@pressh/core";

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;
let clock: number;
let auth: AuthService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-auth-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  clock = 1_000_000;
  auth = await createAuthService({
    storage,
    audit,
    now: () => clock,
    maxFailedAttempts: 3,
    lockoutMs: 60_000,
  });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("AuthService", () => {
  it("creates a user and authenticates successfully", async () => {
    await auth.createUser({ email: "Bob@Example.com", password: "supersecret", roles: ["editor"] });
    const { token, user } = await auth.authenticate({
      email: "bob@example.com",
      password: "supersecret",
    });
    expect(token).toBeTruthy();
    expect(user.email).toBe("bob@example.com");
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("validates and revokes sessions", async () => {
    await auth.createUser({ email: "a@b.com", password: "supersecret", roles: ["author"] });
    const { token } = await auth.authenticate({ email: "a@b.com", password: "supersecret" });
    expect((await auth.validateSession(token))?.email).toBe("a@b.com");
    await auth.logout(token);
    expect(await auth.validateSession(token)).toBeNull();
  });

  it("returns a uniform error for wrong password and unknown user", async () => {
    await auth.createUser({ email: "a@b.com", password: "supersecret", roles: ["author"] });
    await expect(auth.authenticate({ email: "a@b.com", password: "nope" })).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(
      auth.authenticate({ email: "ghost@b.com", password: "whatever" }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects duplicate emails", async () => {
    await auth.createUser({ email: "a@b.com", password: "supersecret", roles: ["author"] });
    await expect(
      auth.createUser({ email: "a@b.com", password: "supersecret", roles: ["author"] }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("locks the account after N failures and audits it", async () => {
    await auth.createUser({ email: "a@b.com", password: "supersecret", roles: ["author"] });
    for (let i = 0; i < 3; i++) {
      await expect(auth.authenticate({ email: "a@b.com", password: "bad" })).rejects.toBeDefined();
    }
    // Even the correct password is now rejected (locked).
    await expect(
      auth.authenticate({ email: "a@b.com", password: "supersecret" }),
    ).rejects.toMatchObject({ code: "rate_limited" });

    const locked = await audit.query({ action: "user.account.locked" });
    expect(locked).toHaveLength(1);

    // After the lockout window, login works again.
    clock += 61_000;
    const { token } = await auth.authenticate({ email: "a@b.com", password: "supersecret" });
    expect(token).toBeTruthy();
  });

  it("resolves capabilities from the user's roles", async () => {
    const user = await auth.createUser({
      email: "ed@b.com",
      password: "supersecret",
      roles: ["editor"],
    });
    const gate = new CapabilityGate();
    expect(gate.check(auth.capabilitiesFor(user), "content.publish")).toBe(true);
    expect(gate.check(auth.capabilitiesFor(user), "users.manage")).toBe(false);
  });
});
