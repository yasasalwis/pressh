import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {StorageAdapter} from "@pressh/core";
import {capabilitiesForRoles, createFileAuditLog, createFileSystemStorage, createRedirectService,} from "@pressh/core";
import {createContentService, createQueryResolver, createSettingsService, DESIGNER_LAYOUT_BLOCK} from "@pressh/engine";
import type {SitePluginHost} from "./app";
import {createSiteApp} from "./app";
import {createRenderCache} from "./cache";

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

describe("storefront product feed binding", () => {
    // A designer page whose body is a collectionList bound to a plugin data source.
    async function makeShopPage(): Promise<void> {
        const type = await content.createType(ADMIN, {
            name: "Shop",
            slug: "shoppage",
            fields: [{id: "1", name: "title", type: "text", required: true}],
        });
        const nodes = [
            {
                id: "list",
                type: "collectionList",
                props: {source: "inventory:products", limit: 4, emptyText: "No products yet."},
                children: [
                    {
                        id: "card",
                        type: "column",
                        children: [{id: "nm", type: "heading", props: {level: 3}, bindings: {text: {field: "name"}}}]
                    },
                ],
            },
        ];
        const shop = await content.createEntry(EDITOR, {
            typeId: type.id,
            slug: "shop",
            authorId: "u1",
            fields: {title: "Shop"},
            blocks: [{type: DESIGNER_LAYOUT_BLOCK, props: {nodes}}],
        });
        await content.transition(EDITOR, shop.id, "published");
    }

    it("renders products from the enabled inventory plugin's feed", async () => {
        await makeShopPage();
        const invHost: SitePluginHost = {
            has: (n) => n === "inventory",
            endpoints: () => [],
            invoke: async (_n, method) =>
                method === "feed" ? {items: [{id: "p1", name: "Test Mug", priceLabel: "$9.50"}]} : {},
        };
        const invApp = createSiteApp({
            resolver: createQueryResolver({content}),
            pluginHost: invHost,
            cache: createRenderCache(),
        });
        const body = await (await invApp.request("/shop")).text();
        expect(body).toContain("Test Mug");
    });

    it("shows the empty state when the plugin is disabled (source unresolved)", async () => {
        await makeShopPage();
        // The default `app` host only knows "hello" → has("inventory") is false.
        const body = await (await app.request("/shop")).text();
        expect(body).toContain("No products yet.");
        expect(body).not.toContain("Test Mug");
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

describe("cookie-consent banner", () => {
    it("injects the consent payload only when enabled", async () => {
        const audit = await createFileAuditLog({path: join(dir, "audit2.log")});
        const settings = createSettingsService({storage, audit});
        const resolver = createQueryResolver({content});

        // Disabled by default → no payload in the page.
        const off = createSiteApp({resolver, pluginHost: stubHost, cache: createRenderCache(), settings});
        const offHtml = await (await off.request("/about")).text();
        expect(offHtml).not.toContain('id="pressh-consent"');

        // Enabled → CSP-safe JSON payload present, carrying the operator's message.
        await settings.updateSettings(ADMIN, {
            consent: {enabled: true, message: "Cookies OK?", policyUrl: "/privacy"},
        });
        const on = createSiteApp({resolver, pluginHost: stubHost, cache: createRenderCache(), settings});
        const onHtml = await (await on.request("/about")).text();
        expect(onHtml).toContain('id="pressh-consent"');
        expect(onHtml).toContain("Cookies OK?");
        expect(onHtml).toContain('type="application/json"');
    });
});

describe("static client assets", () => {
    it("serves a built asset from <clientDir>/assets and blocks traversal", async () => {
        const clientDir = join(dir, "clientdir");
        await mkdir(join(clientDir, "assets"), {recursive: true});
        await writeFile(join(clientDir, "assets", "main-abc123.js"), "console.log('hi')", "utf8");
        await writeFile(join(dir, "secret.txt"), "top secret", "utf8");

        const resolver = createQueryResolver({content});
        const assetApp = createSiteApp({resolver, pluginHost: stubHost, cache: createRenderCache(), clientDir});

        const ok = await assetApp.request("/assets/main-abc123.js");
        expect(ok.status).toBe(200);
        expect(await ok.text()).toContain("console.log");
        expect(ok.headers.get("content-type")).toContain("javascript");

        // Path traversal must not escape the assets root.
        expect((await assetApp.request("/assets/../secret.txt")).status).toBe(404);
        expect((await assetApp.request("/assets/nope.js")).status).toBe(404);
    });
});

describe("redirects", () => {
    it("redirects a not-found path to its target (and 404s unknown paths)", async () => {
        const audit = await createFileAuditLog({path: join(dir, "audit-redir.log")});
        const redirects = createRedirectService({storage, audit});
        await redirects.create({from: "/old-home", to: "/about", code: 301});
        const resolver = createQueryResolver({content});
        const rapp = createSiteApp({resolver, pluginHost: stubHost, cache: createRenderCache(), redirects});

        const hit = await rapp.request("/old-home");
        expect(hit.status).toBe(301);
        expect(hit.headers.get("location")).toBe("/about");

        // A path with no redirect and no content still 404s.
        expect((await rapp.request("/never-existed")).status).toBe(404);
        // A real published page is served normally, not redirected.
        expect((await rapp.request("/about")).status).toBe(200);
    });
});

describe("content search", () => {
    it("returns a results page that links matching published pages", async () => {
        const resolver = createQueryResolver({content});
        const sapp = createSiteApp({resolver, pluginHost: stubHost, cache: createRenderCache()});

        const hit = await sapp.request("/search?q=about");
        expect(hit.status).toBe(200);
        const html = await hit.text();
        expect(html).toContain('href="/about"'); // the published "About Us" page
        expect(html).toContain("result");

        // No query → prompt, no results.
        const empty = await sapp.request("/search");
        expect((await empty.text())).toContain("Enter a search term");

        // A query that matches nothing.
        const none = await sapp.request("/search?q=zzzznomatch");
        expect(await none.text()).toContain("No results");
    });
});

describe("i18n", () => {
    it("routes /fr/, advertises hreflang, and renders a switcher when a page has multiple locales", async () => {
        // The default-locale "about" page exists from beforeEach; add a French sibling.
        const type = await content.createType(ADMIN, {
            name: "I18nPage", slug: "i18npage",
            fields: [{id: "1", name: "title", type: "text", required: true}],
        });
        const fr = await content.createEntry(EDITOR, {
            typeId: type.id, slug: "about", authorId: "u1", fields: {title: "À propos de nous"}, locale: "fr",
        });
        await content.transition(EDITOR, fr.id, "published");

        const resolver = createQueryResolver({content, locales: ["en", "fr"]});
        const iapp = createSiteApp({
            resolver, pluginHost: stubHost, cache: createRenderCache(), locales: ["en", "fr"],
        });

        const en = await iapp.request("/about");
        const enHtml = await en.text();
        expect(enHtml).toContain('hreflang="fr"');
        expect(enHtml).toContain('href="/fr/about"');
        expect(enHtml).toContain("pressh-locales"); // the switcher

        // The locale-prefixed URL resolves to the French entry.
        const frRes = await iapp.request("/fr/about");
        expect(frRes.status).toBe(200);
        expect(await frRes.text()).toContain("À propos de nous");
    });

    it("adds no hreflang/switcher for a single-locale site", async () => {
        const resolver = createQueryResolver({content});
        const sapp = createSiteApp({resolver, pluginHost: stubHost, cache: createRenderCache(), locales: ["en"]});
        const html = await (await sapp.request("/about")).text();
        expect(html).not.toContain("pressh-locales");
        expect(html).not.toContain("hreflang");
    });
});
