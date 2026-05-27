import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import type {AuditLog, MemberAuthService, StorageAdapter} from "@pressh/core";
import {
    createFileAuditLog,
    createFileSecretsBackend,
    createFileSystemStorage,
    createMemberAuthService
} from "@pressh/core";

const REG = {
    email: "alice@example.com",
    password: "hunter2hunter2",
    displayName: "Alice",
};

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;
let svc: MemberAuthService;
let clock: number;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-member-"));
    storage = createFileSystemStorage({root: join(dir, "content")});
    audit = await createFileAuditLog({path: join(dir, "audit.log")});
    clock = 1_000_000_000;
    await createFileSecretsBackend({path: join(dir, "vault.json"), key: randomBytes(32)});
    svc = await createMemberAuthService({storage, audit, now: () => clock});
});

afterEach(async () => {
    storage.close();
    await rm(dir, {recursive: true, force: true});
});

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe("register", () => {
    it("creates a member and returns a verifyToken", async () => {
        const {member, verifyToken} = await svc.register(REG);
        expect(member.email).toBe("alice@example.com");
        expect(member.displayName).toBe("Alice");
        expect(member.emailVerified).toBe(false);
        expect(member.status).toBe("active");
        expect(typeof verifyToken).toBe("string");
        expect(verifyToken.length).toBeGreaterThan(20);
    });

    it("normalises email to lowercase", async () => {
        const {member} = await svc.register({...REG, email: "Alice@Example.COM"});
        expect(member.email).toBe("alice@example.com");
    });

    it("trims displayName", async () => {
        const {member} = await svc.register({...REG, email: "b@b.com", displayName: "  Bob  "});
        expect(member.displayName).toBe("Bob");
    });

    it("rejects duplicate email", async () => {
        await svc.register(REG);
        await expect(svc.register(REG)).rejects.toMatchObject({code: "conflict"});
    });

    it("rejects invalid email", async () => {
        await expect(svc.register({...REG, email: "notanemail"})).rejects.toMatchObject({
            code: "validation",
        });
    });

    it("rejects short password", async () => {
        await expect(svc.register({...REG, password: "short"})).rejects.toMatchObject({
            code: "validation",
        });
    });

    it("rejects empty displayName", async () => {
        await expect(svc.register({...REG, email: "b@b.com", displayName: "   "})).rejects.toMatchObject({
            code: "validation",
        });
    });
});

// ---------------------------------------------------------------------------
// verifyEmail
// ---------------------------------------------------------------------------

describe("verifyEmail", () => {
    it("marks member as verified", async () => {
        const {verifyToken} = await svc.register(REG);
        const verified = await svc.verifyEmail({token: verifyToken});
        expect(verified.emailVerified).toBe(true);
    });

    it("rejects an invalid token", async () => {
        await svc.register(REG);
        await expect(svc.verifyEmail({token: "bogustoken"})).rejects.toMatchObject({
            code: "unauthorized",
        });
    });

    it("rejects a used token (single-use)", async () => {
        const {verifyToken} = await svc.register(REG);
        await svc.verifyEmail({token: verifyToken});
        await expect(svc.verifyEmail({token: verifyToken})).rejects.toMatchObject({
            code: "unauthorized",
        });
    });

    it("rejects an expired token", async () => {
        const {verifyToken} = await svc.register(REG);
        clock += 25 * 60 * 60 * 1000; // 25 hours — past the 24h TTL
        await expect(svc.verifyEmail({token: verifyToken})).rejects.toMatchObject({
            code: "unauthorized",
        });
    });
});

// ---------------------------------------------------------------------------
// authenticate
// ---------------------------------------------------------------------------

async function registerAndVerify(overrides?: Partial<typeof REG>) {
    const input = {...REG, ...overrides};
    const {verifyToken} = await svc.register(input);
    await svc.verifyEmail({token: verifyToken});
    return input;
}

describe("authenticate", () => {
    it("returns a session token and member on success", async () => {
        await registerAndVerify();
        const result = await svc.authenticate({email: REG.email, password: REG.password});
        expect(result.member.email).toBe(REG.email);
        expect(typeof result.token).toBe("string");
    });

    it("rejects wrong password", async () => {
        await registerAndVerify();
        await expect(
            svc.authenticate({email: REG.email, password: "wrongpassword"}),
        ).rejects.toMatchObject({code: "unauthorized"});
    });

    it("rejects an unverified member", async () => {
        await svc.register(REG);
        await expect(
            svc.authenticate({email: REG.email, password: REG.password}),
        ).rejects.toMatchObject({code: "unauthorized"});
    });

    it("rejects an unknown email with the same error as wrong password (anti-enum)", async () => {
        await expect(
            svc.authenticate({email: "ghost@example.com", password: "anything"}),
        ).rejects.toMatchObject({code: "unauthorized"});
    });

    it("locks account after max failed attempts", async () => {
        const strictSvc = await createMemberAuthService({
            storage,
            audit,
            now: () => clock,
            maxFailedAttempts: 3,
        });
        await registerAndVerify();

        for (let i = 0; i < 3; i++) {
            await strictSvc.authenticate({email: REG.email, password: "wrong"}).catch(() => undefined);
        }
        // Even with correct password, account is locked.
        await expect(
            strictSvc.authenticate({email: REG.email, password: REG.password}),
        ).rejects.toMatchObject({code: "unauthorized"});
    });

    it("clears failed attempt counter on successful login", async () => {
        const strictSvc = await createMemberAuthService({
            storage,
            audit,
            now: () => clock,
            maxFailedAttempts: 3,
        });
        await registerAndVerify();

        await strictSvc.authenticate({email: REG.email, password: "wrong"}).catch(() => undefined);
        await strictSvc.authenticate({email: REG.email, password: REG.password});
        // After a successful login, failed counter is reset — can fail again without lock.
        await strictSvc.authenticate({email: REG.email, password: "wrong"}).catch(() => undefined);
        await expect(
            strictSvc.authenticate({email: REG.email, password: REG.password}),
        ).resolves.toMatchObject({member: {email: REG.email}});
    });
});

// ---------------------------------------------------------------------------
// validateSession / logout
// ---------------------------------------------------------------------------

describe("validateSession + logout", () => {
    it("returns the member for a valid session", async () => {
        await registerAndVerify();
        const {token} = await svc.authenticate({email: REG.email, password: REG.password});
        const member = await svc.validateSession(token);
        expect(member?.email).toBe(REG.email);
    });

    it("returns null for an unknown token", async () => {
        expect(await svc.validateSession("not-a-real-token")).toBeNull();
    });

    it("returns null for an expired session", async () => {
        await registerAndVerify();
        const {token} = await svc.authenticate({email: REG.email, password: REG.password});
        clock += 31 * 24 * 60 * 60 * 1000; // past 30-day TTL
        expect(await svc.validateSession(token)).toBeNull();
    });

    it("returns null after logout", async () => {
        await registerAndVerify();
        const {token} = await svc.authenticate({email: REG.email, password: REG.password});
        await svc.logout(token);
        expect(await svc.validateSession(token)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// magic link
// ---------------------------------------------------------------------------

describe("magic link", () => {
    it("round-trip: issue → verify → session", async () => {
        const {member: m} = await svc.register(REG);
        const rawToken = await svc.issueMagicToken(m.id);
        const result = await svc.verifyMagicLink({token: rawToken});
        expect(result.member.email).toBe(REG.email);
        expect(result.member.emailVerified).toBe(true);
        expect(typeof result.token).toBe("string");
        // Session is valid.
        expect(await svc.validateSession(result.token)).not.toBeNull();
    });

    it("implicitly verifies the email", async () => {
        const {member: m} = await svc.register(REG);
        expect(m.emailVerified).toBe(false);
        const rawToken = await svc.issueMagicToken(m.id);
        const {member: after} = await svc.verifyMagicLink({token: rawToken});
        expect(after.emailVerified).toBe(true);
    });

    it("rejects a used magic-link token", async () => {
        const {member: m} = await svc.register(REG);
        const rawToken = await svc.issueMagicToken(m.id);
        await svc.verifyMagicLink({token: rawToken});
        await expect(svc.verifyMagicLink({token: rawToken})).rejects.toMatchObject({
            code: "unauthorized",
        });
    });

    it("rejects an expired magic-link token (15-minute TTL)", async () => {
        const {member: m} = await svc.register(REG);
        const rawToken = await svc.issueMagicToken(m.id);
        clock += 20 * 60 * 1000; // 20 minutes — past the 15-min TTL
        await expect(svc.verifyMagicLink({token: rawToken})).rejects.toMatchObject({
            code: "unauthorized",
        });
    });
});

// ---------------------------------------------------------------------------
// password reset
// ---------------------------------------------------------------------------

describe("password reset", () => {
    it("round-trip: issue → confirm → new password works", async () => {
        await registerAndVerify();
        const {member: m} = (await svc.getMemberByEmail(REG.email)) !== null
            ? {member: (await svc.getMemberByEmail(REG.email))!}
            : await svc.register({...REG, email: "c@c.com"});

        const rawToken = await svc.issuePasswordResetToken(m.id);
        const newPassword = "newpassword123";
        const updated = await svc.confirmPasswordReset({token: rawToken, newPassword});
        expect(updated.emailVerified).toBe(true);

        // Old password no longer works.
        await expect(
            svc.authenticate({email: REG.email, password: REG.password}),
        ).rejects.toMatchObject({code: "unauthorized"});

        // New password works.
        const result = await svc.authenticate({email: REG.email, password: newPassword});
        expect(result.member.email).toBe(REG.email);
    });

    it("rejects a used reset token", async () => {
        const {member: m} = await svc.register(REG);
        const rawToken = await svc.issuePasswordResetToken(m.id);
        await svc.confirmPasswordReset({token: rawToken, newPassword: "newpassword123"});
        await expect(
            svc.confirmPasswordReset({token: rawToken, newPassword: "anotherpassword"}),
        ).rejects.toMatchObject({code: "unauthorized"});
    });

    it("rejects an expired reset token (1-hour TTL)", async () => {
        const {member: m} = await svc.register(REG);
        const rawToken = await svc.issuePasswordResetToken(m.id);
        clock += 2 * 60 * 60 * 1000; // 2 hours — past the 1-hour TTL
        await expect(
            svc.confirmPasswordReset({token: rawToken, newPassword: "newpassword123"}),
        ).rejects.toMatchObject({code: "unauthorized"});
    });

    it("rejects a weak new password", async () => {
        const {member: m} = await svc.register(REG);
        const rawToken = await svc.issuePasswordResetToken(m.id);
        await expect(
            svc.confirmPasswordReset({token: rawToken, newPassword: "short"}),
        ).rejects.toMatchObject({code: "validation"});
    });
});

// ---------------------------------------------------------------------------
// updateProfile
// ---------------------------------------------------------------------------

describe("updateProfile", () => {
    it("updates displayName and bio", async () => {
        const {member: m} = await svc.register(REG);
        const updated = await svc.updateProfile(m.id, {displayName: "Alicia", bio: "Hello world"});
        expect(updated.displayName).toBe("Alicia");
        expect(updated.bio).toBe("Hello world");
    });

    it("sets bio to null when blank string is passed", async () => {
        const {member: m} = await svc.register(REG);
        await svc.updateProfile(m.id, {bio: "something"});
        const updated = await svc.updateProfile(m.id, {bio: "   "});
        expect(updated.bio).toBeNull();
    });

    it("rejects empty displayName", async () => {
        const {member: m} = await svc.register(REG);
        await expect(svc.updateProfile(m.id, {displayName: "  "})).rejects.toMatchObject({
            code: "validation",
        });
    });
});

describe("admin management", () => {
    async function makeVerifiedMember(email: string, name: string): Promise<string> {
        const {member, verifyToken} = await svc.register({email, password: "hunter2hunter2", displayName: name});
        await svc.verifyEmail({token: verifyToken});
        return member.id;
    }

    it("lists members newest-first without secrets", async () => {
        clock += 1000;
        await makeVerifiedMember("a@example.com", "A");
        clock += 1000;
        await makeVerifiedMember("b@example.com", "B");
        const list = await svc.listMembers();
        expect(list.map((m) => m.email)).toEqual(["b@example.com", "a@example.com"]);
        expect(Object.keys(list[0]!)).not.toContain("passwordHash");
    });

    it("suspends a member, revoking active sessions and blocking login", async () => {
        const id = await makeVerifiedMember("c@example.com", "C");
        const {token} = await svc.authenticate({email: "c@example.com", password: "hunter2hunter2"});
        expect(await svc.validateSession(token)).not.toBeNull();

        const suspended = await svc.setMemberStatus(id, "suspended", "admin-1");
        expect(suspended.status).toBe("suspended");
        // The previously-valid session is now dead.
        expect(await svc.validateSession(token)).toBeNull();
        // And a fresh login is refused.
        await expect(
            svc.authenticate({email: "c@example.com", password: "hunter2hunter2"}),
        ).rejects.toMatchObject({code: "unauthorized"});
    });

    it("reactivates a suspended member", async () => {
        const id = await makeVerifiedMember("d@example.com", "D");
        await svc.setMemberStatus(id, "suspended");
        await svc.setMemberStatus(id, "active");
        const ok = await svc.authenticate({email: "d@example.com", password: "hunter2hunter2"});
        expect(ok.member.status).toBe("active");
    });

    it("deletes a member along with their sessions and tokens", async () => {
        const id = await makeVerifiedMember("e@example.com", "E");
        const {token} = await svc.authenticate({email: "e@example.com", password: "hunter2hunter2"});
        await svc.deleteMember(id, "admin-1");
        expect(await svc.getMember(id)).toBeNull();
        expect(await svc.validateSession(token)).toBeNull();
        // Sessions + tokens for the member are gone.
        const sessions = await storage.query("member_sessions", {where: {memberId: id}});
        const tokens = await storage.query("member_tokens", {where: {memberId: id}});
        expect(sessions.ok && sessions.value.items).toEqual([]);
        expect(tokens.ok && tokens.value.items).toEqual([]);
    });

    it("rejects status/delete for an unknown member", async () => {
        await expect(svc.setMemberStatus("ghost", "suspended")).rejects.toMatchObject({code: "not_found"});
        await expect(svc.deleteMember("ghost")).rejects.toMatchObject({code: "not_found"});
    });
});
