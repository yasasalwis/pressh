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
  dir = await mkdtemp(join(tmpdir(), "pressh-studio-theme-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  const auth = await createAuthService({ storage, audit });
  await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
  await auth.createUser({ email: "author@x.com", password: "authorpass1", roles: ["author"] });
  const content = createContentService({ storage, audit });
  const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
  const theme = createThemeService({ storage, audit });
  app = createStudioApp({ auth, content, media, theme, csrf: createCsrf(randomBytes(32)), storage });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("studio theming", () => {
  it("returns settings and available themes", async () => {
    const s = await login("owner@x.com", "ownerpass1");
    const body = (await (await app.request("/admin/api/theme", { headers: { cookie: s.cookie } })).json()) as {
      settings: { theme: string };
      themes: { slug: string }[];
    };
    expect(body.settings.theme).toBe("default");
    expect(body.themes.some((t) => t.slug === "default")).toBe(true);
  });

  it("renders a sandboxed preview with provided tokens", async () => {
    const s = await login("owner@x.com", "ownerpass1");
    const res = await app.request("/admin/api/theme/preview", {
      method: "POST",
      headers: { cookie: s.cookie, "content-type": "application/json" },
      body: JSON.stringify({ tokens: { colorPrimary: "#112233" } }),
    });
    const body = (await res.json()) as { html: string };
    expect(body.html).toContain("--colorPrimary:#112233;");
  });

  it("saves theme settings for an owner", async () => {
    const s = await login("owner@x.com", "ownerpass1");
    const res = await app.request("/admin/api/theme", {
      method: "PUT",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json" },
      body: JSON.stringify({ tokens: { colorPrimary: "#445566" }, siteName: "Owned" }),
    });
    expect(res.status).toBe(200);
  });

  it("forbids an author from saving theme settings", async () => {
    const s = await login("author@x.com", "authorpass1");
    const res = await app.request("/admin/api/theme", {
      method: "PUT",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json" },
      body: JSON.stringify({ tokens: { colorPrimary: "#445566" } }),
    });
    expect(res.status).toBe(403);
  });
});
