import { Hono } from "hono";
import { PressError } from "@pressh/core";
import type { QueryResolver } from "@pressh/engine";
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

export function createSiteApp(deps: SiteAppDeps): Hono {
  const app = new Hono();

  // Strict security headers on every response (baseline #9/#10).
  app.use("*", async (c, next) => {
    await next();
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' https: data:; frame-src https:; object-src 'none'; base-uri 'self'",
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

  // Front controller — resolve any URL at request time (FR-030).
  app.get("*", async (c) => {
    const path = c.req.path;
    const cached = deps.cache.get(path);
    if (cached !== undefined) {
      c.header("X-Cache", "HIT");
      return c.html(cached);
    }
    try {
      const resolved = await deps.resolver.resolvePath(path, { scope: "public" });
      const title =
        typeof resolved.fields["title"] === "string" ? (resolved.fields["title"] as string) : resolved.slug;
      const html = renderPage({
        title,
        body: renderBlocks(resolved.blocks),
        locale: resolved.locale,
      });
      deps.cache.set(path, html, [`content:${resolved.id}`]);
      c.header("X-Cache", "MISS");
      c.header("Cache-Tag", `content:${resolved.id}`);
      return c.html(html);
    } catch (error) {
      if (error instanceof PressError && error.code === "not_found") {
        return c.html(renderNotFound(), 404);
      }
      return c.html(renderPage({ title: "Error", body: "<h1>500 — Server error</h1>" }), 500);
    }
  });

  return app;
}
