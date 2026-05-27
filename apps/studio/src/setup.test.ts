import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import type {StorageAdapter} from "@pressh/core";
import {createAuthService, createCsrf, createFileAuditLog, createFileSystemStorage,} from "@pressh/core";
import {createContentService, createSettingsService, createThemeService} from "@pressh/engine";
import {createStudioApp} from "./app";
import {createMediaService} from "./media";

let dir: string;
let storage: StorageAdapter;
let app: ReturnType<typeof createStudioApp>;

// Note: NO user is seeded here — this is a fresh install.
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-setup-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  const auth = await createAuthService({ storage, audit });
  const content = createContentService({ storage, audit });
  const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
  const theme = createThemeService({ storage, audit });
  const settings = createSettingsService({ storage, audit });
  app = createStudioApp({ auth, content, media, theme, settings, csrf: createCsrf(randomBytes(32)), storage, audit });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("first-run setup wizard", () => {
  it("reports needsSetup on a fresh install", async () => {
    const body = (await (await app.request("/admin/api/setup/status")).json()) as { needsSetup: boolean };
    expect(body.needsSetup).toBe(true);
  });

  it("creates the first Owner and signs them in", async () => {
    const res = await app.request("/admin/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
        body: JSON.stringify({email: "owner@example.com", password: "supersecret-pw"}),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("pressh_session=");

    const token = /pressh_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const me = await app.request("/admin/api/me", { headers: { cookie: `pressh_session=${token}` } });
    const meBody = (await me.json()) as { user: { email: string; roles: string[] } };
    expect(meBody.user.email).toBe("owner@example.com");
    expect(meBody.user.roles).toEqual(["owner"]);
  });

  it("permanently disables setup once a user exists", async () => {
    await app.request("/admin/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
        body: JSON.stringify({email: "owner@example.com", password: "supersecret-pw"}),
    });

    const status = (await (await app.request("/admin/api/setup/status")).json()) as { needsSetup: boolean };
    expect(status.needsSetup).toBe(false);

    const second = await app.request("/admin/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "intruder@example.com", password: "supersecret" }),
    });
    expect(second.status).toBe(409);
  });

    it("rejects a weak owner password and a malformed email", async () => {
        const short = await app.request("/admin/api/setup", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email: "owner@example.com", password: "short"}),
        });
        expect(short.status).toBe(400);

        const badEmail = await app.request("/admin/api/setup", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email: "not-an-email", password: "supersecret-pw"}),
        });
        expect(badEmail.status).toBe(400);

        // Setup is still available after rejected attempts (no Owner was created).
        const status = (await (await app.request("/admin/api/setup/status")).json()) as { needsSetup: boolean };
        expect(status.needsSetup).toBe(true);
    });
});
