import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createAuthService,
  createCsrf,
  createFileAuditLog,
  createFileSystemStorage,
} from "@pressh/core";
import type { StorageAdapter } from "@pressh/core";
import {
  createContentService,
  createGdprService,
  createSettingsService,
  createThemeService,
} from "@pressh/engine";
import { createStudioApp } from "./app";
import { createMediaService } from "./media";

let dir: string;
let storage: StorageAdapter;
let app: ReturnType<typeof createStudioApp>;

async function login(email: string, password: string): Promise<{ cookie: string; csrf: string }> {
  const res = await app.request("/admin/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const token = /pressh_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  const cookie = `pressh_session=${token}`;
  const me = (await (await app.request("/admin/api/me", { headers: { cookie } })).json()) as {
    csrfToken: string;
  };
  return { cookie, csrf: me.csrfToken };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-studio-gdpr-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  const auth = await createAuthService({ storage, audit });
  await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
  await auth.createUser({ email: "author@x.com", password: "authorpass1", roles: ["author"] });
  const content = createContentService({ storage, audit });
  const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
  const theme = createThemeService({ storage, audit });
  const gdpr = createGdprService({
    storage,
    audit,
    scopes: [{ collection: "form_submissions", subjectField: "subjectRef" }],
  });
  const settings = createSettingsService({ storage, audit });
  app = createStudioApp({ auth, content, media, theme, settings, gdpr, csrf: createCsrf(randomBytes(32)), storage, audit });
  await storage.put("form_submissions", { id: randomUUID(), subjectRef: "data@subject.com", message: "hi" });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("studio GDPR routes", () => {
  it("exports a subject's data for an owner", async () => {
    const s = await login("owner@x.com", "ownerpass1");
    const res = await app.request("/admin/api/gdpr/export", {
      method: "POST",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json" },
      body: JSON.stringify({ subjectRef: "data@subject.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { records: { form_submissions: unknown[] } } };
    expect(body.data.records.form_submissions).toHaveLength(1);
  });

  it("erases a subject's data and a later export is empty", async () => {
    const s = await login("owner@x.com", "ownerpass1");
    const erase = await app.request("/admin/api/gdpr/erase", {
      method: "POST",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json" },
      body: JSON.stringify({ subjectRef: "data@subject.com" }),
    });
    expect(erase.status).toBe(200);

    const exp = await app.request("/admin/api/gdpr/export", {
      method: "POST",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json" },
      body: JSON.stringify({ subjectRef: "data@subject.com" }),
    });
    const body = (await exp.json()) as { data: { records: { form_submissions: unknown[] } } };
    expect(body.data.records.form_submissions).toHaveLength(0);
  });

  it("forbids an author from erasing", async () => {
    const s = await login("author@x.com", "authorpass1");
    const res = await app.request("/admin/api/gdpr/erase", {
      method: "POST",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json" },
      body: JSON.stringify({ subjectRef: "data@subject.com" }),
    });
    expect(res.status).toBe(403);
  });
});
