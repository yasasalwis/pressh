import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import type {AuditLog, SecretsBackend, StorageAdapter} from "@pressh/core";
import {createFileAuditLog, createFileSecretsBackend, createFileSystemStorage,} from "@pressh/core";
import type {EmailService, EmailTransport, SettingsService} from "@pressh/engine";
import {
    createEmailService,
    createSettingsService,
    inviteEmail,
    magicLinkEmail,
    passwordResetEmail,
    verificationEmail,
    welcomeEmail,
} from "@pressh/engine";

const SMTP_CONFIG = {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    fromEmail: "noreply@example.com",
    username: "user@example.com",
};

function makeTestTransport() {
    const sent: Array<{
        from: string;
        to: string;
        subject: string;
        html: string;
        text?: string;
    }> = [];

    const transport: EmailTransport = {
        sendMail: async (opts) => {
            sent.push(opts as typeof sent[number]);
            return {messageId: `test-${Date.now()}`};
        },
        verify: (cb) => cb(null, true),
    };

    return {transport, sent};
}

function makeFailTransport(message: string): EmailTransport {
    return {
        sendMail: async () => {
            throw new Error(message);
        },
        verify: (cb) => cb(new Error(message), false),
    };
}

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;
let secrets: SecretsBackend;
let settings: SettingsService;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-email-"));
    storage = createFileSystemStorage({root: join(dir, "content")});
    audit = await createFileAuditLog({path: join(dir, "audit.log")});
    secrets = await createFileSecretsBackend({
        path: join(dir, "vault.json"),
        key: randomBytes(32),
    });
    settings = createSettingsService({storage, audit, secrets});
});

afterEach(async () => {
    storage.close();
    await rm(dir, {recursive: true, force: true});
});

// ---------------------------------------------------------------------------
// isConfigured
// ---------------------------------------------------------------------------

describe("EmailService.isConfigured", () => {
    it("returns false when no SMTP settings exist", async () => {
        const svc = createEmailService({settings, secrets, audit});
        expect(await svc.isConfigured()).toBe(false);
    });

    it("returns false when SMTP settings exist but no password is stored", async () => {
        await settings.updateSettings(["settings.manage"], {smtp: SMTP_CONFIG});
        const svc = createEmailService({settings, secrets, audit});
        expect(await svc.isConfigured()).toBe(false);
    });

    it("returns true when SMTP is fully configured with a password", async () => {
        await settings.updateSettings(["settings.manage"], {
            smtp: SMTP_CONFIG,
            smtpPassword: "s3cret",
        });
        const svc = createEmailService({settings, secrets, audit});
        expect(await svc.isConfigured()).toBe(true);
    });

    it("returns true when _test transport is injected", async () => {
        const {transport} = makeTestTransport();
        const svc = createEmailService({
            settings,
            secrets,
            audit,
            _test: {transport, from: "test@test.local"},
        });
        expect(await svc.isConfigured()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// send
// ---------------------------------------------------------------------------

describe("EmailService.send", () => {
    let svc: EmailService;

    it("throws validation error when SMTP is not configured", async () => {
        svc = createEmailService({settings, secrets, audit});
        await expect(
            svc.send({to: "a@b.com", subject: "Hi", html: "<p>Hi</p>"}),
        ).rejects.toMatchObject({code: "validation"});
    });

    it("throws validation error when SMTP config exists but password is missing", async () => {
        await settings.updateSettings(["settings.manage"], {smtp: SMTP_CONFIG});
        svc = createEmailService({settings, secrets, audit});
        await expect(
            svc.send({to: "a@b.com", subject: "Hi", html: "<p>Hi</p>"}),
        ).rejects.toMatchObject({code: "validation"});
    });

    it("delivers to the injected test transport", async () => {
        const {transport, sent} = makeTestTransport();
        svc = createEmailService({
            settings,
            secrets,
            audit,
            _test: {transport, from: "from@example.com"},
        });

        await svc.send({to: "user@example.com", subject: "Hello", html: "<p>Hi</p>", text: "Hi"});

        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
            from: "from@example.com",
            to: "user@example.com",
            subject: "Hello",
            html: "<p>Hi</p>",
            text: "Hi",
        });
    });

    it("wraps transport send errors as PressError internal", async () => {
        svc = createEmailService({
            settings,
            secrets,
            audit,
            _test: {transport: makeFailTransport("Connection refused"), from: "from@example.com"},
        });

        await expect(
            svc.send({to: "a@b.com", subject: "Test", html: "<p>Test</p>"}),
        ).rejects.toMatchObject({code: "internal"});
    });

    it("appends an audit entry on send failure", async () => {
        svc = createEmailService({
            settings,
            secrets,
            audit,
            _test: {transport: makeFailTransport("ETIMEDOUT"), from: "from@example.com"},
        });

        await expect(svc.send({to: "a@b.com", subject: "Fail", html: "<p>x</p>"})).rejects.toThrow();

        const entries = await audit.query({limit: 10});
        const failEntry = entries.find((e) => e.action === "email.send.failed");
        expect(failEntry).toBeDefined();
        expect(failEntry?.detail).toMatchObject({subject: "Fail"});
    });
});

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

describe("EmailService.verify", () => {
    it("resolves when the test transport verifies successfully", async () => {
        const {transport} = makeTestTransport();
        const svc = createEmailService({
            settings,
            secrets,
            audit,
            _test: {transport, from: "from@example.com"},
        });
        await expect(svc.verify()).resolves.toBeUndefined();
    });

    it("throws PressError internal when verification fails", async () => {
        const svc = createEmailService({
            settings,
            secrets,
            audit,
            _test: {transport: makeFailTransport("Auth failed"), from: "from@example.com"},
        });
        await expect(svc.verify()).rejects.toMatchObject({code: "internal"});
    });

    it("throws validation error when SMTP is not configured", async () => {
        const svc = createEmailService({settings, secrets, audit});
        await expect(svc.verify()).rejects.toMatchObject({code: "validation"});
    });
});

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

describe("verificationEmail", () => {
    it("includes the verify URL in html and text", () => {
        const url = "https://example.com/verify?token=abc123";
        const tpl = verificationEmail({verifyUrl: url, siteName: "Test Site"});
        expect(tpl.html).toContain(url);
        expect(tpl.text).toContain(url);
        expect(tpl.subject).toContain("Test Site");
    });

    it("escapes HTML special characters in siteName", () => {
        const tpl = verificationEmail({
            verifyUrl: "https://example.com/v",
            siteName: "<script>xss</script>",
        });
        expect(tpl.html).not.toContain("<script>xss</script>");
        expect(tpl.html).toContain("&lt;script&gt;");
    });
});

describe("magicLinkEmail", () => {
    it("includes the magic URL and expiry note", () => {
        const url = "https://example.com/magic?token=xyz";
        const tpl = magicLinkEmail({magicUrl: url, siteName: "My Site"});
        expect(tpl.html).toContain(url);
        expect(tpl.text).toContain(url);
        expect(tpl.html).toContain("15 minutes");
        expect(tpl.text).toContain("15 minutes");
    });
});

describe("passwordResetEmail", () => {
    it("includes the reset URL and 1-hour expiry", () => {
        const url = "https://example.com/reset?token=r1";
        const tpl = passwordResetEmail({resetUrl: url, siteName: "My Site"});
        expect(tpl.html).toContain(url);
        expect(tpl.text).toContain(url);
        expect(tpl.html).toContain("1 hour");
    });
});

describe("welcomeEmail", () => {
    it("addresses the member by display name", () => {
        const tpl = welcomeEmail({displayName: "Alice", siteName: "My Site"});
        expect(tpl.html).toContain("Alice");
        expect(tpl.text).toContain("Alice");
        expect(tpl.subject).toContain("My Site");
    });

    it("escapes HTML in displayName", () => {
        const tpl = welcomeEmail({displayName: "<b>bold</b>", siteName: "My Site"});
        expect(tpl.html).not.toContain("<b>bold</b>");
        expect(tpl.html).toContain("&lt;b&gt;");
    });
});

describe("inviteEmail", () => {
    it("includes the invite URL and optional inviter email", () => {
        const url = "https://example.com/invite?token=i1";
        const tpl = inviteEmail({inviteUrl: url, siteName: "My Site", inviterEmail: "admin@example.com"});
        expect(tpl.html).toContain(url);
        expect(tpl.html).toContain("admin@example.com");
        expect(tpl.text).toContain("admin@example.com");
    });

    it("works without an inviter email", () => {
        const url = "https://example.com/invite?token=i2";
        const tpl = inviteEmail({inviteUrl: url, siteName: "My Site"});
        expect(tpl.html).toContain(url);
        expect(tpl.html).toContain("invited");
    });
});
