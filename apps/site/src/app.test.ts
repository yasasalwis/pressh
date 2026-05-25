import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capabilitiesForRoles,
  createFileAuditLog,
  createFileSystemStorage,
} from "@pressh/core";
import type { StorageAdapter } from "@pressh/core";
import { createContentService, createQueryResolver } from "@pressh/engine";
import { createSiteApp } from "./app";
import type { SitePluginHost } from "./app";
import { createRenderCache } from "./cache";

const ADMIN = capabilitiesForRoles(["admin"]);
const EDITOR = capabilitiesForRoles(["editor"]);

const stubHost: SitePluginHost = {
  has: (name) => name === "hello",
  endpoints: () => [{ plugin: "hello", method: "POST", path: "/greet", handler: "greet" }],
  invoke: async (_name, _method, args) => ({ greeted: (args as { name?: string }).name ?? "world" }),
};

let dir: string;
let storage: StorageAdapter;
let app: ReturnType<typeof createSiteApp>;
let content: ReturnType<typeof createContentService>;
let aboutId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-site-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  content = createContentService({ storage, audit });
  const resolver = createQueryResolver({ content });

  const type = await content.createType(ADMIN, {
    name: "Page",
    slug: "page",
    fields: [{ id: "1", name: "title", type: "text", required: true }],
  });
  const about = await content.createEntry(EDITOR, {
    typeId: type.id,
    slug: "about",
    authorId: "u1",
    fields: { title: "About Us" },
    blocks: [{ type: "paragraph", content: "hello<script>alert(1)</script>" }],
  });
  aboutId = about.id;
  await content.transition(EDITOR, aboutId, "published");
  // A second, unpublished page.
  await content.createEntry(EDITOR, {
    typeId: type.id,
    slug: "secret-draft",
    authorId: "u1",
    fields: { title: "Draft" },
  });

  app = createSiteApp({
    resolver,
    pluginHost: stubHost,
    cache: createRenderCache(),
    listPublishedPaths: async () => ["/about"],
    baseUrl: "https://example.test",
  });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("front controller", () => {
  it("renders a published page server-side with security headers", async () => {
    const res = await app.request("/about");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>About Us</title>");
    expect(body).toContain("<p>hello</p>"); // script was sanitized away at write time
    // The injected payload is gone everywhere (rendered HTML and the hydration
    // JSON). The page legitimately carries a CSP-safe `<script type="application/json">`
    // data tag, so we assert the payload — not the substring "<script" — is absent.
    expect(body).not.toContain("alert(1)");
    expect(body).not.toContain("<script>"); // no attribute-less inline script
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("caches on the second request", async () => {
    expect((await app.request("/about")).headers.get("x-cache")).toBe("MISS");
    expect((await app.request("/about")).headers.get("x-cache")).toBe("HIT");
  });

  it("allows every inline <style> via CSP hashes, without 'unsafe-inline'", async () => {
    const res = await app.request("/about");
    const csp = res.headers.get("content-security-policy") ?? "";
    const styleSrc = (csp.match(/style-src[^;]*/) ?? [""])[0];
    const html = await res.text();

    // The page must contain inline styles, and each must be hash-allowlisted.
    const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? "");
    expect(blocks.length).toBeGreaterThan(0);
    for (const css of blocks) {
      const hash = `'sha256-${createHash("sha256").update(css, "utf8").digest("base64")}'`;
      expect(styleSrc).toContain(hash);
    }
    expect(styleSrc).not.toContain("unsafe-inline");
  });

  it("serves fresh content after an edit (cache busts on a new revision)", async () => {
    // Prime the cache with the original content.
    const first = await app.request("/about");
    expect(first.headers.get("x-cache")).toBe("MISS");
    expect(await first.text()).toContain("<p>hello</p>");
    expect((await app.request("/about")).headers.get("x-cache")).toBe("HIT");

    // An editor saves a new revision — this is what a Studio publish does.
    // The Site runs in a separate process, so the only signal is the bumped
    // revision number; the stale cache entry must not be served.
    await content.saveEntry(EDITOR, aboutId, {
      fields: { title: "About Us" },
      blocks: [{ type: "paragraph", content: "brand new copy" }],
      editorId: "u1",
    });

    const after = await app.request("/about");
    expect(after.headers.get("x-cache")).toBe("MISS");
    const body = await after.text();
    expect(body).toContain("<p>brand new copy</p>");
    expect(body).not.toContain("<p>hello</p>");
  });

  it("returns 404 for a draft (published-only public scope)", async () => {
    const res = await app.request("/secret-draft");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a missing page", async () => {
    expect((await app.request("/nope")).status).toBe(404);
  });
});

describe("plugin API dispatcher", () => {
  it("invokes a declared endpoint", async () => {
    const res = await app.request("/api/p/hello/greet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bob" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { greeted: "bob" } });
  });

  it("404s on a wrong method (manifest enforcement)", async () => {
    expect((await app.request("/api/p/hello/greet")).status).toBe(404);
  });

  it("404s on an undeclared action", async () => {
    const res = await app.request("/api/p/hello/undeclared", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("404s on an unknown plugin", async () => {
    const res = await app.request("/api/p/ghost/greet", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("SEO endpoints", () => {
  it("serves robots.txt with the sitemap reference", async () => {
    const body = await (await app.request("/robots.txt")).text();
    expect(body).toContain("Sitemap: https://example.test/sitemap.xml");
  });

  it("serves sitemap.xml listing published paths", async () => {
    const res = await app.request("/sitemap.xml");
    expect(res.headers.get("content-type")).toContain("application/xml");
    const body = await res.text();
    expect(body).toContain("https://example.test/about");
  });
});
