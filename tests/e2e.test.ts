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
  createQueryResolver,
  createThemeService,
} from "@pressh/engine";
import { createMediaService, createStudioApp, seedOwner } from "@pressh/studio";
import { createRenderCache, createSiteApp } from "@pressh/site";
import type { SitePluginHost } from "@pressh/site";

const noPlugins: SitePluginHost = { has: () => false, endpoints: () => [], invoke: async () => null };

let dir: string;
let storage: StorageAdapter;
let studio: ReturnType<typeof createStudioApp>;
let site: ReturnType<typeof createSiteApp>;
let gdpr: ReturnType<typeof createGdprService>;

async function login(email: string, password: string): Promise<{ cookie: string; csrf: string }> {
  const res = await studio.request("/admin/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const token = /pressh_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  const cookie = `pressh_session=${token}`;
  const me = (await (await studio.request("/admin/api/me", { headers: { cookie } })).json()) as {
    csrfToken: string;
  };
  return { cookie, csrf: me.csrfToken };
}

function hdr(s: { cookie: string; csrf: string }): Record<string, string> {
  return { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json" };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-e2e-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  const auth = await createAuthService({ storage, audit });
  const content = createContentService({ storage, audit });
  const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
  const theme = createThemeService({ storage, audit });
  gdpr = createGdprService({ storage, audit, scopes: [{ collection: "form_submissions", subjectField: "subjectRef" }] });
  const csrf = createCsrf(randomBytes(32));

  studio = createStudioApp({ auth, content, media, theme, gdpr, csrf, storage });
  site = createSiteApp({
    resolver: createQueryResolver({ content }),
    pluginHost: noPlugins,
    cache: createRenderCache(),
    themeService: theme,
    storage,
  });

  await seedOwner({ storage, audit, email: "owner@x.com", password: "ownerpass1" });
  await auth.createUser({ email: "author@x.com", password: "authorpass1", roles: ["author"] });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("end-to-end golden path (two processes, one store)", () => {
  it("models a type, authors a page, publishes it, and serves it sanitized + themed", async () => {
    const owner = await login("owner@x.com", "ownerpass1");

    const typeId = (
      (await (
        await studio.request("/admin/api/types", {
          method: "POST",
          headers: hdr(owner),
          body: JSON.stringify({
            name: "Page",
            slug: "page",
            fields: [{ id: "1", name: "title", type: "text", required: true }],
          }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;

    const entryId = (
      (await (
        await studio.request("/admin/api/content", {
          method: "POST",
          headers: hdr(owner),
          body: JSON.stringify({
            typeId,
            slug: "about",
            fields: { title: "About Us" },
            blocks: [{ type: "paragraph", content: "Welcome<script>alert(1)</script>" }],
          }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;

    const publish = await studio.request(`/admin/api/content/${entryId}/publish`, {
      method: "POST",
      headers: hdr(owner),
    });
    expect(publish.status).toBe(200);

    // The Site (separate app, same store) now serves it.
    const page = await site.request("/about");
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<title>About Us</title>");
    expect(html).toContain("Welcome");
    // Injected payload was sanitized at write; the only scripts the page carries
    // are the CSP-safe hydration tags (`type="application/json"` / `type="module"`).
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<script>"); // no attribute-less inline script
    expect(html).toContain("Powered by Pressh"); // themed layout (built-in footer fallback)
  });

  it("enforces authz across the boundary: an author cannot publish", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const typeId = (
      (await (
        await studio.request("/admin/api/types", {
          method: "POST",
          headers: hdr(owner),
          body: JSON.stringify({
            name: "Post",
            slug: "post",
            fields: [{ id: "1", name: "title", type: "text", required: true }],
          }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;

    const author = await login("author@x.com", "authorpass1");
    const entryId = (
      (await (
        await studio.request("/admin/api/content", {
          method: "POST",
          headers: hdr(author),
          body: JSON.stringify({ typeId, slug: "draft", fields: { title: "Draft" } }),
        })
      ).json()) as { data: { id: string } }
    ).data.id;

    const publish = await studio.request(`/admin/api/content/${entryId}/publish`, {
      method: "POST",
      headers: hdr(author),
    });
    expect(publish.status).toBe(403);

    // It stays invisible to the public.
    expect((await site.request("/draft")).status).toBe(404);
  });

  it("satisfies a GDPR export then erasure", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    await storage.put("form_submissions", { id: randomUUID(), subjectRef: "dp@x.com", message: "hi" });

    const exported = (await (
      await studio.request("/admin/api/gdpr/export", {
        method: "POST",
        headers: hdr(owner),
        body: JSON.stringify({ subjectRef: "dp@x.com" }),
      })
    ).json()) as { data: { records: { form_submissions: unknown[] } } };
    expect(exported.data.records.form_submissions).toHaveLength(1);

    await studio.request("/admin/api/gdpr/erase", {
      method: "POST",
      headers: hdr(owner),
      body: JSON.stringify({ subjectRef: "dp@x.com" }),
    });
    expect((await gdpr.export(["gdpr.manage"], "dp@x.com")).records["form_submissions"]).toHaveLength(0);
  });
});
