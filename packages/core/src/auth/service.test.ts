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
      // Even the correct password is now rejected — but with the SAME generic
      // error as a bad password, so a locked account is indistinguishable from a
      // wrong password (no enumeration via the error code).
    await expect(
      auth.authenticate({ email: "a@b.com", password: "supersecret" }),
    ).rejects.toMatchObject({code: "unauthorized"});

    const locked = await audit.query({ action: "user.account.locked" });
    expect(locked).toHaveLength(1);

    // After the lockout window, login works again.
    clock += 61_000;
    const { token } = await auth.authenticate({ email: "a@b.com", password: "supersecret" });
    expect(token).toBeTruthy();
  });

    it("does not reset the failure counter on lockout — a single post-window failure re-locks immediately", async () => {
        await auth.createUser({email: "a@b.com", password: "supersecret", roles: ["author"]});
        // Trip the first lockout (3 failures → locked for lockoutMs = 60s).
        for (let i = 0; i < 3; i++) {
            await expect(auth.authenticate({email: "a@b.com", password: "bad"})).rejects.toBeDefined();
        }
        // Wait out the first window, then fail ONCE more.
        clock += 61_000;
        await expect(auth.authenticate({email: "a@b.com", password: "bad"})).rejects.toBeDefined();
        // Because the counter was NOT reset, that single failure re-locked the
        // account immediately — the correct password is refused within the new
        // window. The attacker gets at most one try per window, not a fresh batch.
        await expect(
            auth.authenticate({email: "a@b.com", password: "supersecret"}),
        ).rejects.toMatchObject({code: "unauthorized"});
    });

    it("escalates the lockout backoff as failures accumulate", async () => {
        await auth.createUser({email: "a@b.com", password: "supersecret", roles: ["author"]});
        const DAY = 26 * 60 * 60 * 1000; // longer than any backoff, so each lock expires
        // 3 failures → first lock; then drive 3 more isolated failures (waiting out
        // each lock) to push the counter to 6 and reach the next backoff tier.
        for (let i = 0; i < 3; i++) {
            await auth.authenticate({email: "a@b.com", password: "bad"}).catch(() => {
            });
        }
        for (let i = 0; i < 3; i++) {
            clock += DAY;
            await auth.authenticate({email: "a@b.com", password: "bad"}).catch(() => {
            });
        }
        const locks = await audit.query({action: "user.account.locked"});
        const backoffs = locks.map((e) => Number(e.detail?.lockedForMs)).filter(Number.isFinite);
        // The latest backoff is strictly larger than the first — it grew.
        expect(Math.max(...backoffs)).toBeGreaterThan(backoffs[0]!);
    });

    it("a locked account and a nonexistent account return the identical error (no enumeration)", async () => {
        await auth.createUser({email: "real@b.com", password: "supersecret", roles: ["author"]});
        for (let i = 0; i < 3; i++) {
            await expect(auth.authenticate({email: "real@b.com", password: "bad"})).rejects.toBeDefined();
        }
        const lockedErr = await auth
            .authenticate({email: "real@b.com", password: "supersecret"})
            .catch((e) => e);
        const ghostErr = await auth
            .authenticate({email: "ghost@b.com", password: "whatever"})
            .catch((e) => e);
        expect(lockedErr.code).toBe("unauthorized");
        expect(ghostErr.code).toBe(lockedErr.code);
        expect(lockedErr.message).toBe(ghostErr.message);
    });

    it("prunes a user's expired sessions on a fresh login (no unbounded growth)", async () => {
        await auth.createUser({email: "a@b.com", password: "supersecret", roles: ["author"]});
        await auth.authenticate({email: "a@b.com", password: "supersecret"}); // session 1
        // Advance past the session TTL so session 1 is expired, then log in again.
        clock += 8 * 24 * 60 * 60 * 1000;
        await auth.authenticate({email: "a@b.com", password: "supersecret"}); // session 2

        const sessions = await storage.query("sessions", {});
        expect(sessions.ok && sessions.value.items).toHaveLength(1); // expired one pruned
    });

    it("revokes existing sessions when a user's roles change", async () => {
        const user = await auth.createUser({email: "a@b.com", password: "supersecret", roles: ["author"]});
        const {token} = await auth.authenticate({email: "a@b.com", password: "supersecret"});
        expect(await auth.validateSession(token)).not.toBeNull();

        await auth.updateUser(user.id, {roles: ["editor"]});
        // The pre-existing session no longer validates — the user must re-auth so
        // the new role set takes effect immediately.
        expect(await auth.validateSession(token)).toBeNull();
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

describe("AuthService — user administration", () => {
  it("lists users newest-first without secrets", async () => {
    await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
    clock += 1000;
    await auth.createUser({ email: "ed@x.com", password: "editorpass1", roles: ["editor"] });
    const users = await auth.listUsers();
    expect(users).toHaveLength(2);
    expect(users[0]?.email).toBe("ed@x.com"); // newest first
    expect(users[0]).not.toHaveProperty("passwordHash");
    expect(users[0]?.mustChangePassword).toBe(false);
  });

  it("updates roles and status", async () => {
    await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
    const ed = await auth.createUser({ email: "ed@x.com", password: "editorpass1", roles: ["editor"] });
    const updated = await auth.updateUser(ed.id, { roles: ["admin"], status: "disabled" });
    expect(updated.roles).toEqual(["admin"]);
    expect(updated.status).toBe("disabled");
  });

  it("refuses to remove or disable the last active owner", async () => {
    const owner = await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
    await expect(auth.updateUser(owner.id, { status: "disabled" })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(auth.updateUser(owner.id, { roles: ["editor"] })).rejects.toMatchObject({
      code: "conflict",
    });
    // A SECOND owner makes demoting the first one allowed again.
    await auth.createUser({ email: "owner2@x.com", password: "ownerpass2", roles: ["owner"] });
    const demoted = await auth.updateUser(owner.id, { roles: ["editor"] });
    expect(demoted.roles).toEqual(["editor"]);
  });

  it("creates a user with a temp password that must be changed", async () => {
    await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
    const { user, temporaryPassword } = await auth.adminCreateUser({
      email: "new@x.com",
      roles: ["author"],
    });
    expect(user.mustChangePassword).toBe(true);
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(8);
    // The temp password works for login.
    const { user: loggedIn } = await auth.authenticate({ email: "new@x.com", password: temporaryPassword });
    expect(loggedIn.mustChangePassword).toBe(true);
  });

  it("changes a password and clears the must-change flag", async () => {
    const { user, temporaryPassword } = await auth.adminCreateUser({
      email: "new@x.com",
      roles: ["author"],
    });
    await expect(
      auth.changePassword(user.id, "wrong-current", "brand-new-pass"),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await auth.changePassword(user.id, temporaryPassword, "brand-new-pass");
    const after = await auth.getUser(user.id);
    expect(after?.mustChangePassword).toBe(false);
    const { token } = await auth.authenticate({ email: "new@x.com", password: "brand-new-pass" });
    expect(token).toBeTruthy();
  });
});

describe("AuthService — invitations", () => {
  it("creates, lists, and accepts an invite", async () => {
    const owner = await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
    const { invite, token } = await auth.createInvite({
      email: "invitee@x.com",
      roles: ["editor"],
      actorId: owner.id,
    });
    expect(invite.email).toBe("invitee@x.com");
    expect(invite).not.toHaveProperty("tokenHash");

    const pending = await auth.listInvites();
    expect(pending.some((i) => i.id === invite.id)).toBe(true);

    const { token: session, user } = await auth.acceptInvite({ token, password: "inviteepass1" });
    expect(session).toBeTruthy();
    expect(user.email).toBe("invitee@x.com");
    expect(user.roles).toEqual(["editor"]);
    expect(user.mustChangePassword).toBe(false);

    // Invite is consumed: no longer pending and not reusable.
    expect((await auth.listInvites()).some((i) => i.id === invite.id)).toBe(false);
    await expect(auth.acceptInvite({ token, password: "again12345" })).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("rejects an expired invite", async () => {
    const { token } = await auth.createInvite({
      email: "late@x.com",
      roles: ["author"],
      ttlMs: 1000,
    });
    clock += 2000;
    await expect(auth.acceptInvite({ token, password: "latepass123" })).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("revokes a pending invite", async () => {
    const { invite } = await auth.createInvite({ email: "x@x.com", roles: ["viewer"] });
    await auth.revokeInvite(invite.id);
    expect((await auth.listInvites()).some((i) => i.id === invite.id)).toBe(false);
  });
});
