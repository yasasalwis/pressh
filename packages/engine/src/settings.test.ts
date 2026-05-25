import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  capabilitiesForRoles,
  createFileAuditLog,
  createFileSecretsBackend,
  createFileSystemStorage,
} from "@pressh/core";
import type { AuditLog, SecretsBackend, StorageAdapter } from "@pressh/core";
import { createSettingsService } from "./settings.js";

const ADMIN = capabilitiesForRoles(["admin"]);
const VIEWER = capabilitiesForRoles(["viewer"]);

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;
let secrets: SecretsBackend;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-settings-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  secrets = await createFileSecretsBackend({ path: join(dir, "vault.json"), key: randomBytes(32) });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("SettingsService", () => {
  it("returns defaults before anything is saved", async () => {
    const svc = createSettingsService({ storage, audit, secrets });
    const s = await svc.getSettings();
    expect(s.baseUrl).toBe("");
    expect(s.defaultLocale).toBe("en");
    expect(s.timezone).toBe("UTC");
    expect(s.smtp).toBeNull();
    expect(s.smtpAvailable).toBe(true);
    expect(s.maintenanceMode).toBe(false);
  });

  it("toggles maintenance mode and rejects non-boolean values", async () => {
    const svc = createSettingsService({ storage, audit, secrets });
    const on = await svc.updateSettings(ADMIN, { maintenanceMode: true });
    expect(on.maintenanceMode).toBe(true);
    // Persisted across reads.
    expect((await svc.getSettings()).maintenanceMode).toBe(true);
    const off = await svc.updateSettings(ADMIN, { maintenanceMode: false });
    expect(off.maintenanceMode).toBe(false);
    await expect(
      svc.updateSettings(ADMIN, { maintenanceMode: "yes" as unknown as boolean }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("requires settings.manage to update", async () => {
    const svc = createSettingsService({ storage, audit, secrets });
    await expect(svc.updateSettings(VIEWER, { baseUrl: "https://x.com" })).rejects.toMatchObject({
      code: "capability_denied",
    });
  });

  it("validates baseUrl, locale, and timezone", async () => {
    const svc = createSettingsService({ storage, audit, secrets });
    await expect(svc.updateSettings(ADMIN, { baseUrl: "not a url" })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(svc.updateSettings(ADMIN, { defaultLocale: "english" })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(svc.updateSettings(ADMIN, { timezone: "Mars/Olympus" })).rejects.toMatchObject({
      code: "validation",
    });
    const ok = await svc.updateSettings(ADMIN, {
      baseUrl: "https://example.com",
      defaultLocale: "en-US",
      timezone: "America/New_York",
    });
    expect(ok.baseUrl).toBe("https://example.com");
    expect(ok.defaultLocale).toBe("en-US");
    expect(ok.timezone).toBe("America/New_York");
  });

  it("stores the SMTP password in the vault, never in the doc", async () => {
    const svc = createSettingsService({ storage, audit, secrets });
    const view = await svc.updateSettings(ADMIN, {
      smtp: { host: "smtp.example.com", port: 587, secure: false, fromEmail: "hi@example.com", username: "mailer" },
      smtpPassword: "super-secret-pw",
    });
    expect(view.smtp?.hasPassword).toBe(true);
    expect(view.smtp).not.toHaveProperty("password");
    // The stored settings document holds no password.
    const raw = await storage.get("settings", "general");
    expect(JSON.stringify(raw)).not.toContain("super-secret-pw");
    // The vault holds it.
    expect(await secrets.getSecret("smtp.password")).toBe("super-secret-pw");
  });

  it("clearing SMTP removes the stored password", async () => {
    const svc = createSettingsService({ storage, audit, secrets });
    await svc.updateSettings(ADMIN, {
      smtp: { host: "smtp.example.com", port: 587, secure: false, fromEmail: "hi@example.com", username: "mailer" },
      smtpPassword: "super-secret-pw",
    });
    const cleared = await svc.updateSettings(ADMIN, { smtp: null });
    expect(cleared.smtp).toBeNull();
    expect(await secrets.hasSecret("smtp.password")).toBe(false);
  });

  it("refuses an SMTP password when no vault is configured", async () => {
    const svc = createSettingsService({ storage, audit }); // no secrets backend
    const s = await svc.getSettings();
    expect(s.smtpAvailable).toBe(false);
    await expect(
      svc.updateSettings(ADMIN, {
        smtp: { host: "smtp.example.com", port: 587, secure: false, fromEmail: "hi@example.com", username: "mailer" },
        smtpPassword: "pw",
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });
});
