import { createHash } from "node:crypto";
import { Hono } from "hono";
import { PressError, createMetrics, requestId } from "@pressh/core";
import type { Metrics, StorageAdapter } from "@pressh/core";
import {
  DESIGNER_LAYOUT_BLOCK,
  collectStyles,
  createComponentRegistry,
  registerBuiltinComponents,
  renderLayout,
} from "@pressh/engine";
import type { ComponentContext, GdprService, LayoutNode, QueryResolver, ThemeService } from "@pressh/engine";
import type { RenderCache } from "./cache.js";
import { escapeHtml, renderBlocks, renderNotFound, renderPage } from "./render.js";

/** Minimal structural view of the PluginHost the site needs. */
export interface SitePluginHost {
  has(name: string): boolean;
  endpoints(): { plugin: string; method: string; path: string; handler: string }[];
  invoke(name: string, method: string, args: unknown): Promise<unknown>;
}

export interface SiteAppDeps {
  resolver: QueryResolver;
  pluginHost: SitePluginHost;
  cache: RenderCache;
  themeService?: ThemeService;
  gdpr?: GdprService;
  storage?: StorageAdapter;
  metrics?: Metrics;
  listPublishedPaths?: () => Promise<string[]>;
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

const siteComponentRegistry = createComponentRegistry();
registerBuiltinComponents(siteComponentRegistry);

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

function makeSiteContext(resolver: QueryResolver, storage?: StorageAdapter): ComponentContext {
  return {
    async fetchContent(slug) {
      try {
        const r = await resolver.resolve({ slug, scope: "public" });
        return { ...r.fields, slug: r.slug, publishedAt: r.publishedAt };
      } catch {
        return null;
      }
    },
    async listPublished(limit = 10) {
      if (!storage) return [];
      const result = await storage.query("content_entries", { where: { status: "published" } }, { limit });
      if (!result.ok) return [];
      return result.value.items as Record<string, unknown>[];
    },
  };
}

export function createSiteApp(deps: SiteAppDeps): Hono<SiteEnv> {
  const app = new Hono<SiteEnv>();
  const metrics = deps.metrics ?? createMetrics();

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
  app.get("/metrics", (c) => c.text(metrics.render(), 200, { "content-type": "text/plain; version=0.0.4" }));

  // Strict security headers on every response (baseline #9/#10). The HTML
  // handlers set `styleCsp` to a hashed `style-src` so the SSR'd theme/component
  // styles apply without ever allowing `'unsafe-inline'`.
  app.use("*", async (c, next) => {
    await next();
    const styleSrc = c.get("styleCsp") ?? "style-src 'self'";
    c.header(
      "Content-Security-Policy",
      `default-src 'self'; ${styleSrc}; img-src 'self' https: data:; frame-src https:; object-src 'none'; base-uri 'self'`,
    );
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (deps.production) {
      c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }
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
    const plugin = c.req.param("plugin");
    const action = c.req.param("action");
    if (!deps.pluginHost.has(plugin)) {
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
      const resolved = await deps.resolver.resolvePath(path, { scope: "public" });
      // Serve cached HTML only while it matches the current content version.
      // Resolving is cheap (local reads); this lets a Studio publish go live on
      // the separate Site process without restart (see cache.ts).
      const version = String(resolved.revision);
      const cached = deps.cache.get(path);
      if (cached && cached.version === version) {
        c.header("X-Cache", "HIT");
        c.header("Cache-Tag", `content:${resolved.id}`);
        c.set("styleCsp", styleSrcDirective(cached.html));
        return c.html(cached.html);
      }
      const title =
        typeof resolved.fields["title"] === "string" ? (resolved.fields["title"] as string) : resolved.slug;

      const layoutBlock = (resolved.blocks as Array<{ type: string; props?: Record<string, unknown> }>).find(
        (b) => b.type === DESIGNER_LAYOUT_BLOCK,
      );
      const layoutNodes = Array.isArray(layoutBlock?.props?.["nodes"]) ? (layoutBlock!.props!["nodes"] as LayoutNode[]) : [];
      let body: string;
      let componentStyles = "";
      if (layoutNodes.length) {
        const ctx = makeSiteContext(deps.resolver, deps.storage);
        body = await renderLayout(layoutNodes, siteComponentRegistry, ctx);
        componentStyles = collectStyles(layoutNodes, siteComponentRegistry);
      } else {
        body = renderBlocks(resolved.blocks);
      }
      let html: string;
      if (deps.themeService) {
        const t = await deps.themeService.resolve();
        const layoutWithStyles = componentStyles
          ? body.replace("</head>", `<style>${componentStyles}</style></head>`)
          : body;
        const themeHtml = t.theme.layout({ title, body: layoutWithStyles, locale: resolved.locale, cssVars: t.cssVars, siteName: t.siteName });
        html = componentStyles ? themeHtml.replace("</head>", `<style>${componentStyles}</style></head>`) : themeHtml;
      } else {
        html = renderPage({ title, body, locale: resolved.locale, extraStyles: componentStyles });
      }
      deps.cache.set(path, html, version, [`content:${resolved.id}`]);
      c.header("X-Cache", "MISS");
      c.header("Cache-Tag", `content:${resolved.id}`);
      c.set("styleCsp", styleSrcDirective(html));
      return c.html(html);
    } catch (error) {
      if (error instanceof PressError && error.code === "not_found") {
        const notFound = renderNotFound();
        c.set("styleCsp", styleSrcDirective(notFound));
        return c.html(notFound, 404);
      }
      const errorPage = renderPage({ title: "Error", body: "<h1>500 — Server error</h1>" });
      c.set("styleCsp", styleSrcDirective(errorPage));
      return c.html(errorPage, 500);
    }
  });

  return app;
}
