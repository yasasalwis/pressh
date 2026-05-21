import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  capabilitiesForRoles,
  createFileAuditLog,
  createFileSecretsBackend,
  createFileSystemStorage,
} from "@pressh/core";
import type { AuditLog, SecretsBackend, StorageAdapter } from "@pressh/core";
import { createGdprService } from "@pressh/engine";
import type { GdprService } from "@pressh/engine";

const ADMIN = capabilitiesForRoles(["admin"]); // has gdpr.manage
const AUTHOR = capabilitiesForRoles(["author"]); // does not

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;
let secrets: SecretsBackend;
let gdpr: GdprService;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-gdpr-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  secrets = await createFileSecretsBackend({ path: join(dir, "vault.json"), key: randomBytes(32) });
  clock = 1_000_000;
  gdpr = createGdprService({
    storage,
    audit,
    secrets,
    now: () => clock,
    scopes: [{ collection: "form_submissions", subjectField: "subjectRef", timestampField: "at", retentionMs: 1000 }],
  });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("GdprService", () => {
  it("requires gdpr.manage for export and erase", async () => {
    await expect(gdpr.export(AUTHOR, "a@b.com")).rejects.toMatchObject({ code: "capability_denied" });
    await expect(gdpr.erase(AUTHOR, "a@b.com")).rejects.toMatchObject({ code: "capability_denied" });
  });

  it("exports all of a subject's data and reveals protected fields", async () => {
    const ssn = await gdpr.protect("a@b.com", "123-45-6789");
    await storage.put("form_submissions", { id: randomUUID(), subjectRef: "a@b.com", ssn, at: "2026-01-01T00:00:00Z" });
    await gdpr.recordConsent("a@b.com", "analytics", true);

    const exported = await gdpr.export(ADMIN, "a@b.com");
    expect(exported.records["form_submissions"]).toHaveLength(1);
    expect((exported.records["form_submissions"]?.[0] as { ssn: string }).ssn).toBe("123-45-6789");
    expect(exported.records["consent_records"]).toHaveLength(1);
  });

  it("erases data, crypto-shreds secrets, and leaves only a hashed tombstone", async () => {
    const secret = await gdpr.protect("a@b.com", "sensitive");
    await storage.put("form_submissions", { id: randomUUID(), subjectRef: "a@b.com", secret, at: "2026-01-01T00:00:00Z" });
    await gdpr.recordConsent("a@b.com", "analytics", true);

    const { erasedCount } = await gdpr.erase(ADMIN, "a@b.com");
    expect(erasedCount).toBeGreaterThanOrEqual(2);

    // Subsequent export is empty.
    const after = await gdpr.export(ADMIN, "a@b.com");
    expect(after.records["form_submissions"]).toHaveLength(0);
    expect(after.records["consent_records"]).toHaveLength(0);

    // The protected secret is unrecoverable (crypto-shred).
    await expect(gdpr.reveal(secret)).rejects.toMatchObject({ code: "not_found" });

    // The erase audit entry retains only a hash, never the raw email.
    const entries = await audit.query({ action: "gdpr.erase" });
    expect(JSON.stringify(entries)).not.toContain("a@b.com");
  });

  it("records and reads the latest consent", async () => {
    await gdpr.recordConsent("a@b.com", "analytics", false);
    clock += 10;
    await gdpr.recordConsent("a@b.com", "analytics", true);
    expect(await gdpr.getConsent("a@b.com", "analytics")).toBe(true);
    expect(await gdpr.getConsent("a@b.com", "unknown")).toBeNull();
  });

  it("purges records past their retention window", async () => {
    await storage.put("form_submissions", {
      id: randomUUID(),
      subjectRef: "a@b.com",
      at: new Date(clock - 5000).toISOString(), // older than 1000ms retention
    });
    await storage.put("form_submissions", {
      id: randomUUID(),
      subjectRef: "a@b.com",
      at: new Date(clock).toISOString(),
    });
    const { purged } = await gdpr.applyRetention();
    expect(purged).toBe(1);
  });
});
