import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createAuthService, createCsrf, createFileAuditLog, createFileSystemStorage } from "@pressh/core";
import type { StorageAdapter } from "@pressh/core";
import { createContentService, createSettingsService, createThemeService } from "@pressh/engine";
import { createStudioApp } from "./app";
import { createMediaService } from "./media";
import { createMigrationLock } from "./migration-lock";

let dir: string;
let storage: StorageAdapter;
let app: ReturnType<typeof createStudioApp>;
const lock = createMigrationLock();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-lock-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  const auth = await createAuthService({ storage, audit });
  await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
  const content = createContentService({ storage, audit });
  const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
  const theme = createThemeService({ storage, audit });
  const settings = createSettingsService({ storage, audit });
  const csrf = createCsrf(randomBytes(32));
  lock.unlock();
  app = createStudioApp({ auth, content, media, theme, settings, csrf, storage, audit, migrationLock: lock });
});

afterEach(async () => {
  lock.unlock();
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("migration lock", () => {
  it("returns 409 for a data mutation while locked (before auth runs)", async () => {
    lock.lock();
    const res = await app.request("/admin/api/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ typeId: "t", slug: "x", fields: {} }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("conflict");
  });

  it("does not block reads while locked", async () => {
    lock.lock();
    // No session → 401 (read path reached), NOT 409.
    expect((await app.request("/admin/api/content")).status).toBe(401);
  });

  it("does not block auth routes while locked", async () => {
    lock.lock();
    const res = await app.request("/admin/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@x.com", password: "ownerpass1" }),
    });
    expect(res.status).toBe(200);
  });

  it("allows mutations again once unlocked", async () => {
    lock.lock();
    expect((await app.request("/admin/api/content", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(409);
    lock.unlock();
    // Unlocked → mutation reaches auth and is rejected as unauthorized (401), not 409.
    expect((await app.request("/admin/api/content", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
  });
});
