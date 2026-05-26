import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import type {StorageAdapter} from "@pressh/core";
import {createAuthService, createCsrf, createFileAuditLog, createFileSystemStorage,} from "@pressh/core";
import {createContentService, createSettingsService, createThemeService} from "@pressh/engine";
import type {PanelProvider} from "./app";
import {createStudioApp} from "./app";
import {createMediaService} from "./media";

const panels: PanelProvider = {
  list: async () => [{ plugin: "hello", title: "Hello Panel" }],
  get: async (plugin) =>
      plugin === "hello" ? {title: "Hello Panel", script: "window.__helloPanel=1"} : null,
};

let dir: string;
let storage: StorageAdapter;
let app: ReturnType<typeof createStudioApp>;

async function loginCookie(): Promise<string> {
  const res = await app.request("/admin/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@x.com", password: "ownerpass1" }),
  });
  const token = /pressh_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  return `pressh_session=${token}`;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-panels-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  const auth = await createAuthService({ storage, audit });
  await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
  const content = createContentService({ storage, audit });
  const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
  const theme = createThemeService({ storage, audit });
  const settings = createSettingsService({ storage, audit });
  app = createStudioApp({ auth, content, media, theme, settings, csrf: createCsrf(randomBytes(32)), storage, audit, panels });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("plugin panel routes", () => {
  it("requires a session", async () => {
    expect((await app.request("/admin/plugins")).status).toBe(401);
  });

  it("lists panels", async () => {
    const cookie = await loginCookie();
    const body = (await (await app.request("/admin/plugins", { headers: { cookie } })).json()) as {
      items: { plugin: string }[];
    };
    expect(body.items[0]?.plugin).toBe("hello");
  });

  it("embeds the panel in a sandbox without allow-same-origin", async () => {
    const cookie = await loginCookie();
    const html = await (await app.request("/admin/plugins/hello", { headers: { cookie } })).text();
    expect(html).toContain('sandbox="allow-scripts allow-forms"');
    expect(html).not.toContain("allow-same-origin");
  });

  it("serves the panel document with a strict CSP", async () => {
    const cookie = await loginCookie();
    const res = await app.request("/admin/plugins/hello/panel", { headers: { cookie } });
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    const html = await res.text();
      expect(html).toContain('<div id="pressh-root"></div>'); // React mount target
      expect(html).toContain("window.__helloPanel=1"); // inlined panel bundle
      expect(html).toContain("window.presshPanel"); // host bridge shim
  });

  it("404s for an unknown plugin panel", async () => {
    const cookie = await loginCookie();
    expect((await app.request("/admin/plugins/ghost/panel", { headers: { cookie } })).status).toBe(404);
  });
});
