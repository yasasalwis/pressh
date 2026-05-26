import {createHash} from "node:crypto";
import {createReadStream, existsSync, statSync} from "node:fs";
import {extname, resolve as resolvePath} from "node:path";
import {Readable} from "node:stream";
import {createElement} from "react";
import {renderToString} from "react-dom/server";
import type {Context} from "hono";
import {Hono} from "hono";
import type {Metrics, StorageAdapter} from "@pressh/core";
import {createMetrics, createRateLimiter, PressError, requestId} from "@pressh/core";
import type {
  BlockNode,
  ContentEntry,
  GdprService,
  PrimitiveNode,
  PrimitiveRenderContext,
  QueryResolver,
  ThemeService,
} from "@pressh/engine";
import {DESIGNER_LAYOUT_BLOCK, renderTree, SYSTEM_SLUGS} from "@pressh/engine";
import type {RenderCache} from "./cache.js";
import {escapeHtml, renderNotFound, renderPage} from "./render.js";
import {Blocks} from "./components/Blocks.js";
import {Page} from "./components/Page.js";
import {getClientAssets} from "./manifest.js";

/** Minimal structural view of the PluginHost the site needs. */
export interface SitePluginHost {
  has(name: string): boolean;
  endpoints(): { plugin: string; method: string; path: string; handler: string }[];
  invoke(name: string, method: string, args: unknown): Promise<unknown>;
}

export interface SiteAppDeps {
  resolver: QueryResolver;
  pluginHost: SitePluginHost;
  /**
   * Per-request enabled gate. The Site loads only enabled plugins at boot, but
   * this lets a Studio-side disable take effect publicly without a Site restart:
   * a running worker still won't serve once its persisted state flips off.
   */
  isPluginEnabled?: (name: string) => Promise<boolean>;
  cache: RenderCache;
  themeService?: ThemeService;
  gdpr?: GdprService;
  storage?: StorageAdapter;
  metrics?: Metrics;
  listPublishedPaths?: () => Promise<string[]>;
  /** Absolute path to dist/client/ for serving Vite-built assets at /assets/*. */
  clientDir?: string;
  baseUrl?: string;
  production?: boolean;
}

function mapError(error: unknown): { status: 400 | 403 | 404 | 500; code: string } {
  const code = error instanceof PressError ? error.code : "internal";
  if (code === "not_found") return { status: 404, code };
  if (code === "forbidden" || code === "capability_denied") return { status: 403, code };
  if (code === "validation") return { status: 400, code };
  return { status: 500, code };
}

/** Per-request context vars. */
type SiteEnv = { Variables: { styleCsp: string } };

/**
 * Builds the `style-src` CSP directive for a server-rendered HTML document by
 * hashing every inline `<style>` block it contains. This keeps the strict CSP
 * (no `'unsafe-inline'`) while letting the theme + component styles apply.
 * Hashes are derived from the (deterministic) markup, so they stay valid for
 * cached pages — unlike a per-request nonce, which would break on cache hits.
 */
function styleSrcDirective(html: string): string {
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
  const hashes: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const digest = createHash("sha256").update(match[1] ?? "", "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes.length ? `style-src 'self' ${hashes.join(" ")}` : "style-src 'self'";
}

/**
 * Injects Vite client assets and the hydration data payload into a themed
 * HTML document string (which has <head> and <body> but was produced by the
 * theme's layout function rather than React).
 */
function injectAssetsIntoThemeHtml(
  html: string,
  blocks: BlockNode[],
  title: string,
  locale: string,
): string {
  const assets = getClientAssets();
  const serialised = JSON.stringify({ blocks, title, locale }).replace(/<\//g, "<\\/");

  const linkTags = assets.styles
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join("");
  const dataTag = `<script type="application/json" id="pressh-data">${serialised}</script>`;
  const scriptTag = assets.script
    ? `<script type="module" src="${escapeHtml(assets.script)}"></script>`
    : "";

  return html
    .replace("</head>", `${linkTags}</head>`)
    .replace("</body>", `${dataTag}${scriptTag}</body>`);
}

interface SeoMeta {
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  robots?: string;
}

/** Builds escaped <meta>/OpenGraph tags from the SEO plugin's resolved meta. */
function seoMetaTags(meta: SeoMeta): string {
  const tags: string[] = [];
  if (meta.description) tags.push(`<meta name="description" content="${escapeHtml(meta.description)}">`);
  if (meta.robots) tags.push(`<meta name="robots" content="${escapeHtml(meta.robots)}">`);
  if (meta.ogTitle) tags.push(`<meta property="og:title" content="${escapeHtml(meta.ogTitle)}">`);
  if (meta.ogDescription)
    tags.push(`<meta property="og:description" content="${escapeHtml(meta.ogDescription)}">`);
  if (meta.ogImage) tags.push(`<meta property="og:image" content="${escapeHtml(meta.ogImage)}">`);
  return tags.join("");
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Data access for data primitives (CollectionList). Published entries hold only
 * slug/publishedAt; the displayable fields (title, …) live in the current
 * revision, so each entry is resolved to flatten its fields for binding.
 */
function makeSiteContext(
    resolver: QueryResolver,
    storage?: StorageAdapter,
    pluginHost?: SitePluginHost,
): PrimitiveRenderContext {
  return {
    async listPublished(query) {
      // A `source` of the form "<plugin>:<resource>" (e.g. "inventory:products")
      // is served by that plugin's `feed` handler — but only while it's enabled
      // (has() is true only for a running worker). This keeps plugin-owned data
      // (products) out of the engine's content store yet bindable in the designer.
      const source = query.source;
      if (source && source.includes(":") && pluginHost) {
        const plugin = source.split(":")[0] ?? "";
        if (!plugin || !pluginHost.has(plugin)) return [];
        try {
          const res = (await pluginHost.invoke(plugin, "feed", {
            limit: query.limit,
            sort: query.sortBy,
          })) as { items?: unknown[] } | null;
          return Array.isArray(res?.items) ? (res!.items as Record<string, unknown>[]) : [];
        } catch {
          return [];
        }
      }
      if (!storage) return [];
      const limit = Math.min(Math.max(1, query.limit ?? 10), 50);
      const result = await storage.query(
        "content_entries",
        { where: { status: "published" } },
        { limit: 200 },
      );
      if (!result.ok) return [];

        // System pages (header/footer chrome, 404/500/maintenance) are published
        // but are not editorial content — they must never surface in a content feed
        // like a "recent posts" list.
        const entries = (result.value.items as ContentEntry[]).filter((e) => !e.system);
      entries.sort((a, b) => {
        const av = a.publishedAt ?? "";
        const bv = b.publishedAt ?? "";
        return query.order === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });

      const items: Record<string, unknown>[] = [];
      for (const entry of entries.slice(0, limit)) {
        let fields: Record<string, unknown> = {};
        try {
          const r = await resolver.resolve({ slug: entry.slug, scope: "public" });
          fields = r.fields;
        } catch {
          fields = {};
        }
        items.push({
          ...fields,
          title: fields["title"] ?? entry.slug,
          slug: entry.slug,
          publishedAt: entry.publishedAt ?? "",
        });
      }
      return items;
    },
  };
}

interface RenderedFragment {
  html: string;
  css: string;
  revision: number;
}

/** Fetches and renders a system layout page (header/footer) by slug. Returns null when the page has no designer layout yet. */
async function renderSystemFragment(
  slug: string,
  resolver: QueryResolver,
  ctx: PrimitiveRenderContext,
): Promise<RenderedFragment | null> {
  try {
    const content = await resolver.resolve({ slug, scope: "public" });
    const layoutBlock = (content.blocks as Array<{ type: string; props?: Record<string, unknown> }>).find(
      (b) => b.type === DESIGNER_LAYOUT_BLOCK,
    );
    const nodes = Array.isArray(layoutBlock?.props?.["nodes"]) ? layoutBlock!.props!["nodes"] as PrimitiveNode[] : [];
    if (!nodes.length) return null;
    const rendered = await renderTree(nodes, ctx);
    return { html: rendered.html, css: rendered.css, revision: content.revision };
  } catch {
    return null;
  }
}

/**
 * Renders the operator's "maintenance" system page for a 503 response. Used
 * while the Database Manager copies records (a migration window): the public
 * site is read-only/offline so no write lands in the store being replaced.
 * Falls back to a minimal static page if the system page can't be resolved.
 */
async function renderMaintenancePage(deps: SiteAppDeps): Promise<string> {
  try {
    const resolved = await deps.resolver.resolve({ slug: SYSTEM_SLUGS.maintenance, scope: "public" });
    const title =
      typeof resolved.fields["title"] === "string" ? (resolved.fields["title"] as string) : "Down for maintenance";
    const blocks = resolved.blocks as BlockNode[];
    const bodyHtml = renderToString(createElement(Blocks, { blocks }));
    if (deps.themeService) {
      const t = await deps.themeService.resolve();
      return t.theme.layout({
        title,
        body: `<div id="root">${bodyHtml}</div>`,
        locale: resolved.locale,
        cssVars: t.cssVars,
        siteName: t.siteName,
      });
    }
    return renderPage({ title, body: bodyHtml, locale: resolved.locale });
  } catch {
    return renderPage({
      title: "Down for maintenance",
      body: "<h1>We&rsquo;ll be right back</h1><p>The site is temporarily offline for scheduled maintenance. Please check back shortly.</p>",
    });
  }
}

/**
 * Renders a standalone system page (404 / 500) as a full themed document, with
 * the site's own header/footer chrome so visitors can navigate away. Handles
 * both designer-authored layouts and block content. Returns null when the page
 * can't be resolved (e.g. before it's seeded, or during a storage outage) so the
 * caller can fall back to a minimal static page.
 */
async function renderSystemDocument(deps: SiteAppDeps, slug: string): Promise<string | null> {
  try {
    const ctx = makeSiteContext(deps.resolver, deps.storage, deps.pluginHost);
    const resolved = await deps.resolver.resolve({slug, scope: "public"});
    const title =
        typeof resolved.fields["title"] === "string" ? (resolved.fields["title"] as string) : resolved.slug;
    const locale = resolved.locale;
    const blocks = resolved.blocks as BlockNode[];

    const layoutBlock = (resolved.blocks as Array<{ type: string; props?: Record<string, unknown> }>).find(
        (b) => b.type === DESIGNER_LAYOUT_BLOCK,
    );
    const layoutNodes = Array.isArray(layoutBlock?.props?.["nodes"])
        ? (layoutBlock!.props!["nodes"] as PrimitiveNode[])
        : [];

    let bodyHtml: string;
    let componentStyles = "";
    if (layoutNodes.length) {
      const rendered = await renderTree(layoutNodes, ctx);
      bodyHtml = rendered.html;
      componentStyles =
          "main{max-width:none!important;margin:0!important;padding:0!important;width:100%!important}" +
          rendered.css;
    } else {
      bodyHtml = renderToString(createElement(Blocks, {blocks}));
    }

    const [headerFragment, footerFragment] = await Promise.all([
      renderSystemFragment(SYSTEM_SLUGS.header, deps.resolver, ctx),
      renderSystemFragment(SYSTEM_SLUGS.footer, deps.resolver, ctx),
    ]);
    const headerHtml = headerFragment
        ? `<style>${headerFragment.css}</style>${headerFragment.html}`
        : undefined;
    const footerHtml = footerFragment
        ? `<style>${footerFragment.css}</style>${footerFragment.html}`
        : undefined;

    if (deps.themeService) {
      const t = await deps.themeService.resolve();
      const wrappedBody = componentStyles
          ? `<style>${componentStyles}</style><div id="root">${bodyHtml}</div>`
          : `<div id="root">${bodyHtml}</div>`;
      return t.theme.layout({
        title,
        body: wrappedBody,
        locale,
        cssVars: t.cssVars,
        siteName: t.siteName,
        ...(headerHtml !== undefined ? {header: headerHtml} : {}),
        ...(footerHtml !== undefined ? {footer: footerHtml} : {}),
      });
    }
    return renderPage({
      title,
      body: `<div id="root">${bodyHtml}</div>`,
      locale,
      ...(componentStyles ? {extraStyles: componentStyles} : {}),
    });
  } catch {
    return null;
  }
}

export function createSiteApp(deps: SiteAppDeps): Hono<SiteEnv> {
  const app = new Hono<SiteEnv>();
  const metrics = deps.metrics ?? createMetrics();

  // Per-IP throttle for the public write/compute endpoints (consent capture and
  // plugin dispatch) so a single source can't flood storage or worker invokes
  // (baseline #12). Behind a proxy, x-forwarded-for identifies the client.
  const publicLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
  const clientKey = (c: Context<SiteEnv>): string => {
    const xff = c.req.header("x-forwarded-for");
    return (xff ? (xff.split(",")[0] ?? "").trim() : "") || c.req.header("x-real-ip") || "unknown";
  };
  // /metrics requires a bearer token when PRESSH_METRICS_TOKEN is set.
  const metricsToken = process.env["PRESSH_METRICS_TOKEN"];

  // Request-id correlation + request metrics (TDD §9).
  app.use("*", async (c, next) => {
    const id = requestId(c.req.header("x-request-id"));
    c.header("x-request-id", id);
    const start = Date.now();
    await next();
    metrics.inc("pressh_http_requests_total", "HTTP requests", { status: String(c.res.status) });
    metrics.observe("pressh_http_request_ms", "HTTP request duration (ms)", Date.now() - start);
  });

  // Ops endpoints.
  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    if (!deps.storage) return c.json({ status: "ready" });
    const probe = await deps.storage.listCollections();
    return probe.ok ? c.json({ status: "ready" }) : c.json({ status: "unavailable" }, 503);
  });
  app.get("/metrics", (c) => {
    if (metricsToken && c.req.header("authorization") !== `Bearer ${metricsToken}`) {
      return c.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    return c.text(metrics.render(), 200, { "content-type": "text/plain; version=0.0.4" });
  });

  // Strict security headers on every response (baseline #9/#10). The HTML
  // handlers set `styleCsp` to a hashed `style-src` so the SSR'd theme/component
  // styles apply without ever allowing `'unsafe-inline'`.
  app.use("*", async (c, next) => {
    await next();
    const styleSrc = c.get("styleCsp") ?? "style-src 'self'";
    c.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self'; ${styleSrc}; img-src 'self' https: data:; frame-src https:; object-src 'none'; base-uri 'self'`,
    );
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (deps.production) {
      c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }
  });

  // Vite-built client assets — immutable cache since filenames are content-hashed.
  if (deps.clientDir) {
    const safeRoot = resolvePath(deps.clientDir);
    app.get("/assets/*", (c) => {
      const rel = c.req.path.slice("/assets".length);
      const abs = resolvePath(safeRoot, "assets", rel);
      if (!abs.startsWith(safeRoot) || !existsSync(abs) || !statSync(abs).isFile()) {
        return c.notFound();
      }
      const mime = MIME_TYPES[extname(abs)] ?? "application/octet-stream";
      const stream = createReadStream(abs);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          "content-type": mime,
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    });
  }

  // Maintenance mode (settings.maintenanceMode): serve the maintenance system
  // page with HTTP 503 for every public route below — including form/plugin
  // writes — so a DB migration window loses no data. Health checks and /assets
  // are registered above this guard and stay reachable. A short TTL avoids a
  // settings read on every request while still reacting within seconds.
  let maintCache: { on: boolean; at: number } | null = null;
  const MAINT_TTL_MS = 3000;
  const maintenanceOn = async (): Promise<boolean> => {
    if (!deps.storage) return false;
    const now = Date.now();
    if (maintCache && now - maintCache.at < MAINT_TTL_MS) return maintCache.on;
    const res = await deps.storage.get<{ id: string; maintenanceMode?: boolean }>("settings", "general");
    const on = res.ok && res.value ? res.value.maintenanceMode === true : false;
    maintCache = { on, at: now };
    return on;
  };
  app.use("*", async (c, next) => {
    if (await maintenanceOn()) {
      const html = await renderMaintenancePage(deps);
      c.set("styleCsp", styleSrcDirective(html));
      c.header("Retry-After", "120");
      c.header("Cache-Control", "no-store");
      return c.html(html, 503);
    }
    await next();
    return undefined;
  });

  app.get("/robots.txt", (c) =>
    c.text(`User-agent: *\nAllow: /\nSitemap: ${deps.baseUrl ?? ""}/sitemap.xml\n`),
  );

  app.get("/sitemap.xml", async (c) => {
    const paths = deps.listPublishedPaths ? await deps.listPublishedPaths() : [];
    const urls = paths
      .map((p) => `<url><loc>${escapeHtml((deps.baseUrl ?? "") + p)}</loc></url>`)
      .join("");
    c.header("Content-Type", "application/xml; charset=utf-8");
    return c.body(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    );
  });

  // Dynamic plugin endpoints — runtime dispatch, manifest-enforced (FR-024).
  app.all("/api/p/:plugin/:action", async (c) => {
    if (!publicLimiter.check(clientKey(c))) {
      return c.json({ error: { code: "rate_limited", message: "Too many requests" } }, 429);
    }
    const plugin = c.req.param("plugin");
    const action = c.req.param("action");
    if (!deps.pluginHost.has(plugin)) {
      return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
    }
    // Honor a runtime disable even before this process restarts (see deps doc).
    if (deps.isPluginEnabled && !(await deps.isPluginEnabled(plugin))) {
      return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
    }
    const endpoint = deps.pluginHost
      .endpoints()
      .find(
        (e) => e.plugin === plugin && e.path === `/${action}` && e.method.toUpperCase() === c.req.method,
      );
    if (!endpoint) {
      return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
    }

    let args: unknown = {};
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      try {
        args = await c.req.json();
      } catch {
        args = {};
      }
    }

    try {
      const result = await deps.pluginHost.invoke(plugin, endpoint.handler, args);
      return c.json({ ok: true, result });
    } catch (error) {
      const { status, code } = mapError(error);
      return c.json({ error: { code, message: code } }, status);
    }
  });

  // Public consent capture (Art. 6/7). Anonymous, no auth — the data subject acts.
  app.post("/api/consent", async (c) => {
    if (!publicLimiter.check(clientKey(c))) {
      return c.json({ error: { code: "rate_limited", message: "Too many requests" } }, 429);
    }
    if (!deps.gdpr) return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
    const body = await c.req
      .json<{ subjectRef?: string; scope?: string; granted?: boolean }>()
      .catch(() => ({}) as { subjectRef?: string; scope?: string; granted?: boolean });
    if (typeof body.subjectRef !== "string" || typeof body.scope !== "string") {
      return c.json({ error: { code: "validation", message: "subjectRef and scope required" } }, 400);
    }
    await deps.gdpr.recordConsent(body.subjectRef, body.scope, body.granted === true);
    return c.json({ ok: true });
  });

  // Front controller — resolve any URL at request time (FR-030).
  app.get("*", async (c) => {
    const path = c.req.path;
    try {
      const ctx = makeSiteContext(deps.resolver, deps.storage, deps.pluginHost);

      // Fetch system layout pages. Done before cache check so their revision
      // can be included in the version key — a header/footer save invalidates
      // all cached pages automatically.
      const isSystemSlug = (s: string) => s === SYSTEM_SLUGS.header || s === SYSTEM_SLUGS.footer;
      const [headerFragment, footerFragment] = await Promise.all([
        renderSystemFragment(SYSTEM_SLUGS.header, deps.resolver, ctx),
        renderSystemFragment(SYSTEM_SLUGS.footer, deps.resolver, ctx),
      ]);

      const resolved = await deps.resolver.resolvePath(path, { scope: "public" });

      // Privacy-friendly analytics: server-side page-view count, fire-and-forget
      // so it never blocks the response. No cookies, no client JS, no third
      // parties — only counts when the analytics plugin is enabled.
      if (deps.pluginHost.has("analytics")) {
        void deps.pluginHost.invoke("analytics", "collect", { path }).catch(() => undefined);
      }

      // Serve cached HTML only while it matches the current content version.
      // Resolving is cheap (local reads); this lets a Studio publish go live on
      // the separate Site process without restart (see cache.ts).
      const version = `${resolved.revision}:h${headerFragment?.revision ?? 0}:f${footerFragment?.revision ?? 0}`;
      const cached = deps.cache.get(path);
      if (cached && cached.version === version) {
        c.header("X-Cache", "HIT");
        c.header("Cache-Tag", `content:${resolved.id}`);
        c.set("styleCsp", styleSrcDirective(cached.html));
        return c.html(cached.html);
      }

      const title =
        typeof resolved.fields["title"] === "string"
          ? (resolved.fields["title"] as string)
          : resolved.slug;
      const blocks = resolved.blocks as BlockNode[];
      const locale = resolved.locale;

      // Render the body — either from the visual designer (renderTree) or React SSR.
      const layoutBlock = (resolved.blocks as Array<{ type: string; props?: Record<string, unknown> }>).find(
        (b) => b.type === DESIGNER_LAYOUT_BLOCK,
      );
      const layoutNodes = Array.isArray(layoutBlock?.props?.["nodes"])
        ? (layoutBlock!.props!["nodes"] as PrimitiveNode[])
        : [];

      let bodyHtml: string;
      let componentStyles = "";
      if (layoutNodes.length) {
        const rendered = await renderTree(layoutNodes, ctx);
        bodyHtml = rendered.html;
        // Designer pages are full-page compositions, not prose: release the
        // theme's max-width <main> so sections can span full-bleed (their inner
        // `container` primitives re-center content). Deterministic → CSP-hash stable.
        componentStyles =
          "main{max-width:none!important;margin:0!important;padding:0!important;width:100%!important}" +
          rendered.css;
      } else {
        bodyHtml = renderToString(createElement(Blocks, { blocks }));
      }

      // System pages viewed directly don't get header/footer injected (avoids recursion).
      const skipLayout = isSystemSlug(resolved.slug);
      const headerHtml = !skipLayout && headerFragment
        ? `<style>${headerFragment.css}</style>${headerFragment.html}`
        : undefined;
      const footerHtml = !skipLayout && footerFragment
        ? `<style>${footerFragment.css}</style>${footerFragment.html}`
        : undefined;

      // Build the full HTML document.
      let html: string;
      if (deps.themeService) {
        const t = await deps.themeService.resolve();
        const wrappedBody = componentStyles
          ? `<style>${componentStyles}</style><div id="root">${bodyHtml}</div>`
          : `<div id="root">${bodyHtml}</div>`;
        const themeHtml = t.theme.layout({
          title,
          body: wrappedBody,
          locale,
          cssVars: t.cssVars,
          siteName: t.siteName,
          ...(headerHtml !== undefined ? { header: headerHtml } : {}),
          ...(footerHtml !== undefined ? { footer: footerHtml } : {}),
        });
        html = injectAssetsIntoThemeHtml(themeHtml, blocks, title, locale);
      } else {
        const assets = getClientAssets();
        html =
          "<!DOCTYPE html>" +
          renderToString(
            createElement(Page, {
              title,
              locale,
              blocks,
              bodyHtml,
              ...(componentStyles ? { extraStyles: componentStyles } : {}),
              ...(assets.script ? { clientScript: assets.script } : {}),
              clientStyles: assets.styles,
            }),
          );
      }

      // SEO plugin: inject per-page <meta>/OpenGraph tags. Done on the miss path
      // so the cached HTML already carries them (no plugin call on cache hits).
      if (deps.pluginHost.has("seo")) {
        try {
          const meta = (await deps.pluginHost.invoke("seo", "metaFor", {
            slug: resolved.slug,
          })) as SeoMeta;
          const tags = seoMetaTags(meta);
          if (tags) html = html.replace("</head>", `${tags}</head>`);
        } catch {
          // SEO is best-effort — never block a page render on it.
        }
      }

      deps.cache.set(path, html, version, [`content:${resolved.id}`]);
      c.header("X-Cache", "MISS");
      c.header("Cache-Tag", `content:${resolved.id}`);
      c.set("styleCsp", styleSrcDirective(html));
      return c.html(html);
    } catch (error) {
      if (error instanceof PressError && error.code === "not_found") {
        const notFound = (await renderSystemDocument(deps, SYSTEM_SLUGS.notFound)) ?? renderNotFound();
        c.set("styleCsp", styleSrcDirective(notFound));
        return c.html(notFound, 404);
      }
      const errorPage =
          (await renderSystemDocument(deps, SYSTEM_SLUGS.serverError)) ??
          renderPage({title: "Error", body: "<h1>500 — Server error</h1>"});
      c.set("styleCsp", styleSrcDirective(errorPage));
      return c.html(errorPage, 500);
    }
  });

  return app;
}
