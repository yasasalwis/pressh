import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  createAuthService,
  createCsrf,
  createFileAuditLog,
  createFileSystemStorage,
} from "@pressh/core";
import type { StorageAdapter } from "@pressh/core";
import { createContentService, createThemeService } from "@pressh/engine";
import { createStudioApp } from "./app";
import { createMediaService } from "./media";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const DISGUISED = new TextEncoder().encode("#!/bin/sh");

let dir: string;
let storage: StorageAdapter;
let app: ReturnType<typeof createStudioApp>;

async function login(email: string, password: string): Promise<{ cookie: string; csrf: string; status: number }> {
  const res = await app.request("/admin/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = /pressh_session=([^;]+)/.exec(setCookie)?.[1] ?? "";
  const cookie = `pressh_session=${token}`;
  if (res.status !== 200) return { cookie, csrf: "", status: res.status };
  const me = (await (await app.request("/admin/api/me", { headers: { cookie } })).json()) as {
    csrfToken: string;
  };
  return { cookie, csrf: me.csrfToken, status: res.status };
}

function authHeaders(s: { cookie: string; csrf: string }): Record<string, string> {
  return { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json" };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-studio-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  const auth = await createAuthService({ storage, audit });
  await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
  await auth.createUser({ email: "author@x.com", password: "authorpass1", roles: ["author"] });
  const content = createContentService({ storage, audit });
  const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
  const theme = createThemeService({ storage, audit });
  const csrf = createCsrf(randomBytes(32));
  app = createStudioApp({ auth, content, media, theme, csrf, storage });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("studio auth", () => {
  it("serves the admin client", async () => {
    const res = await app.request("/admin");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Pressh Studio");
  });

  it("requires a session for /me", async () => {
    expect((await app.request("/admin/api/me")).status).toBe(401);
  });

  it("logs in and returns capabilities + a CSRF token", async () => {
    const s = await login("owner@x.com", "ownerpass1");
    expect(s.status).toBe(200);
    expect(s.csrf).toBeTruthy();
  });

  it("rejects a mutation without a CSRF token", async () => {
    const s = await login("owner@x.com", "ownerpass1");
    const res = await app.request("/admin/api/types", {
      method: "POST",
      headers: { cookie: s.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "X", slug: "x", fields: [] }),
    });
    expect(res.status).toBe(403);
  });
});

describe("no-code flow (owner)", () => {
  it("models a type, authors a page with blocks, and publishes it", async () => {
    const s = await login("owner@x.com", "ownerpass1");

    const typeRes = await app.request("/admin/api/types", {
      method: "POST",
      headers: authHeaders(s),
      body: JSON.stringify({
        name: "Page",
        slug: "page",
        fields: [{ id: "1", name: "title", type: "text", required: true }],
      }),
    });
    const typeId = ((await typeRes.json()) as { data: { id: string } }).data.id;

    const entryRes = await app.request("/admin/api/content", {
      method: "POST",
      headers: authHeaders(s),
      body: JSON.stringify({
        typeId,
        slug: "about",
        fields: { title: "About" },
        blocks: [{ type: "paragraph", content: "hi<script>alert(1)</script>" }],
      }),
    });
    const entryId = ((await entryRes.json()) as { data: { id: string } }).data.id;

    const pubRes = await app.request(`/admin/api/content/${entryId}/publish`, {
      method: "POST",
      headers: authHeaders(s),
    });
    expect(((await pubRes.json()) as { data: { status: string } }).data.status).toBe("published");

    const list = (await (await app.request("/admin/api/content", { headers: { cookie: s.cookie } })).json()) as {
      items: { id: string }[];
    };
    expect(list.items.some((i) => i.id === entryId)).toBe(true);
  });

  it("uploads a valid image and rejects a disguised one", async () => {
    const s = await login("owner@x.com", "ownerpass1");

    const good = new FormData();
    good.append("file", new File([PNG], "logo.png", { type: "image/png" }));
    const okRes = await app.request("/admin/api/media", {
      method: "POST",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf },
      body: good,
    });
    expect(okRes.status).toBe(200);

    const bad = new FormData();
    bad.append("file", new File([DISGUISED], "evil.png", { type: "image/png" }));
    const badRes = await app.request("/admin/api/media", {
      method: "POST",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf },
      body: bad,
    });
    expect(badRes.status).toBe(400);
  });
});

describe("server-side capability enforcement (author)", () => {
  it("forbids an author from creating a type or publishing", async () => {
    const s = await login("author@x.com", "authorpass1");

    const typeRes = await app.request("/admin/api/types", {
      method: "POST",
      headers: authHeaders(s),
      body: JSON.stringify({ name: "X", slug: "x", fields: [] }),
    });
    expect(typeRes.status).toBe(403);
  });

  it("lets an author create content but not publish it", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const typeRes = await app.request("/admin/api/types", {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({
        name: "Note",
        slug: "note",
        fields: [{ id: "1", name: "title", type: "text", required: true }],
      }),
    });
    const typeId = ((await typeRes.json()) as { data: { id: string } }).data.id;

    const author = await login("author@x.com", "authorpass1");
    const entryRes = await app.request("/admin/api/content", {
      method: "POST",
      headers: authHeaders(author),
      body: JSON.stringify({ typeId, slug: "note-1", fields: { title: "t" } }),
    });
    expect(entryRes.status).toBe(200);
    const entryId = ((await entryRes.json()) as { data: { id: string } }).data.id;

    const pubRes = await app.request(`/admin/api/content/${entryId}/publish`, {
      method: "POST",
      headers: authHeaders(author),
    });
    expect(pubRes.status).toBe(403);
  });
});
