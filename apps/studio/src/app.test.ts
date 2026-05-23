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
import { createContentService, createSettingsService, createThemeService } from "@pressh/engine";
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
  const settings = createSettingsService({ storage, audit });
  const csrf = createCsrf(randomBytes(32));
  app = createStudioApp({ auth, content, media, theme, settings, csrf, storage, audit });
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

describe("user administration", () => {
  it("forbids an author from listing users", async () => {
    const author = await login("author@x.com", "authorpass1");
    const res = await app.request("/admin/api/users", { headers: { cookie: author.cookie } });
    expect(res.status).toBe(403);
  });

  it("lists users and creates one with a temp password", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const listed = (await (await app.request("/admin/api/users", { headers: { cookie: owner.cookie } })).json()) as {
      users: { email: string }[];
    };
    expect(listed.users.length).toBe(2);

    const created = await app.request("/admin/api/users", {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({ email: "newbie@x.com", roles: ["editor"] }),
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as { data: { user: { mustChangePassword: boolean }; temporaryPassword: string } };
    expect(body.data.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(body.data.user.mustChangePassword).toBe(true);
  });

  it("refuses to disable the last active owner (409)", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const users = (await (await app.request("/admin/api/users", { headers: { cookie: owner.cookie } })).json()) as {
      users: { id: string; roles: string[] }[];
    };
    const ownerId = users.users.find((u) => u.roles.includes("owner"))!.id;
    const res = await app.request(`/admin/api/users/${ownerId}`, {
      method: "PUT",
      headers: authHeaders(owner),
      body: JSON.stringify({ status: "disabled" }),
    });
    expect(res.status).toBe(409);
  });

  it("invites a user and lets them accept it (public)", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const inviteRes = await app.request("/admin/api/users/invite", {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({ email: "invitee@x.com", roles: ["author"] }),
    });
    const { data } = (await inviteRes.json()) as { data: { token: string } };
    expect(data.token).toBeTruthy();

    const accept = await app.request("/admin/api/invite/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: data.token, password: "inviteepass1" }),
    });
    expect(accept.status).toBe(200);
    // The new account can now log in.
    const s = await login("invitee@x.com", "inviteepass1");
    expect(s.status).toBe(200);
  });
});

describe("settings", () => {
  it("reads and writes general settings", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const put = await app.request("/admin/api/settings", {
      method: "PUT",
      headers: authHeaders(owner),
      body: JSON.stringify({ baseUrl: "https://site.example", defaultLocale: "en-US", timezone: "UTC" }),
    });
    expect(put.status).toBe(200);
    const get = (await (await app.request("/admin/api/settings", { headers: { cookie: owner.cookie } })).json()) as {
      settings: { baseUrl: string };
    };
    expect(get.settings.baseUrl).toBe("https://site.example");
  });

  it("rejects an invalid base URL", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const put = await app.request("/admin/api/settings", {
      method: "PUT",
      headers: authHeaders(owner),
      body: JSON.stringify({ baseUrl: "not a url" }),
    });
    expect(put.status).toBe(400);
  });
});

describe("media library + audit", () => {
  it("lists, serves, and deletes media", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const form = new FormData();
    form.append("file", new File([PNG], "pic.png", { type: "image/png" }));
    const up = await app.request("/admin/api/media", {
      method: "POST",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
      body: form,
    });
    const mediaId = ((await up.json()) as { data: { id: string } }).data.id;

    const list = (await (await app.request("/admin/api/media", { headers: { cookie: owner.cookie } })).json()) as {
      items: { id: string }[];
    };
    expect(list.items.some((m) => m.id === mediaId)).toBe(true);

    const raw = await app.request(`/admin/api/media/${mediaId}/raw`, { headers: { cookie: owner.cookie } });
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toBe("image/png");

    const del = await app.request(`/admin/api/media/${mediaId}`, {
      method: "DELETE",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    });
    expect(del.status).toBe(200);
  });

  it("exposes the audit log to owners but not authors", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const ok = await app.request("/admin/api/audit?limit=5", { headers: { cookie: owner.cookie } });
    expect(ok.status).toBe(200);
    const author = await login("author@x.com", "authorpass1");
    const denied = await app.request("/admin/api/audit", { headers: { cookie: author.cookie } });
    expect(denied.status).toBe(403);
  });
});

describe("revisions", () => {
  it("lists and restores a prior revision", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const typeRes = await app.request("/admin/api/types", {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({ name: "Doc", slug: "doc", fields: [{ id: "1", name: "title", type: "text", required: true }] }),
    });
    const typeId = ((await typeRes.json()) as { data: { id: string } }).data.id;
    const entryRes = await app.request("/admin/api/content", {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({ typeId, slug: "doc-1", fields: { title: "v1" }, blocks: [] }),
    });
    const entryId = ((await entryRes.json()) as { data: { id: string } }).data.id;
    await app.request(`/admin/api/content/${entryId}`, {
      method: "PUT",
      headers: authHeaders(owner),
      body: JSON.stringify({ fields: { title: "v2" }, blocks: [] }),
    });

    const revs = (await (await app.request(`/admin/api/content/${entryId}/revisions`, {
      headers: { cookie: owner.cookie },
    })).json()) as { items: { version: number }[] };
    expect(revs.items.length).toBe(2);

    const restore = await app.request(`/admin/api/content/${entryId}/revisions/1/restore`, {
      method: "POST",
      headers: authHeaders(owner),
    });
    expect(restore.status).toBe(200);
  });
});
