import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { createFileAuditLog, createFileSystemStorage } from "@pressh/core";
import {
  createContentService,
  createGdprService,
  createQueryResolver,
  createThemeService,
} from "@pressh/engine";
import { PluginHost, createCveService } from "@pressh/runtime";
import { createSiteApp } from "./app.js";
import { createRenderCache } from "./cache.js";

export interface SiteServerOptions {
  contentRoot: string;
  auditPath?: string;
  port?: number;
  baseUrl?: string;
  production?: boolean;
}

/**
 * Wires the real engine + plugin runtime for the public site process. This is
 * the Site half of the two-process trust split (ADR-002); it boots its own
 * PluginHost, separate from the Studio process.
 */
export async function createSiteServer(opts: SiteServerOptions): Promise<{
  start: () => void;
  cache: ReturnType<typeof createRenderCache>;
}> {
  const storage = createFileSystemStorage({ root: opts.contentRoot });
  const audit = await createFileAuditLog({
    path: opts.auditPath ?? join(opts.contentRoot, "..", "audit.log"),
  });
  const content = createContentService({ storage, audit });
  const resolver = createQueryResolver({ content });
  const themeService = createThemeService({ storage, audit });
  const gdpr = createGdprService({
    storage,
    audit,
    scopes: [{ collection: "form_submissions", subjectField: "subjectRef", timestampField: "at" }],
  });
  // Shares the CVE store the Studio syncs; the Site's host refuses flagged plugins too.
  const cve = createCveService({ storage, audit, source: { fetch: async () => [] } });
  const pluginHost = new PluginHost({ storage, audit, allowUnsigned: !opts.production, cve });
  const cache = createRenderCache();

  const listPublishedPaths = async (): Promise<string[]> => {
    const result = await storage.query("content_entries", { where: { status: "published" } });
    if (!result.ok) return [];
    return result.value.items.map((entry) => {
      const slug = String((entry as { slug?: unknown }).slug ?? "");
      const locale = String((entry as { locale?: unknown }).locale ?? "en");
      return `/${locale !== "en" ? `${locale}/` : ""}${slug}`;
    });
  };

  const app = createSiteApp({
    resolver,
    pluginHost,
    cache,
    themeService,
    gdpr,
    storage,
    listPublishedPaths,
    ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.production !== undefined ? { production: opts.production } : {}),
  });

  return {
    start: () => {
      serve({ fetch: app.fetch, port: opts.port ?? 3000 });
    },
    cache,
  };
}

/** Start the Site from environment variables when run directly (`node dist/server.js`). */
async function runFromEnv(): Promise<void> {
  const port = Number(process.env["PRESSH_SITE_PORT"] ?? 3000);
  const server = await createSiteServer({
    contentRoot: process.env["PRESSH_CONTENT_ROOT"] ?? "./data/content",
    port,
    production: process.env["NODE_ENV"] === "production",
    ...(process.env["PRESSH_BASE_URL"] ? { baseUrl: process.env["PRESSH_BASE_URL"] } : {}),
  });
  server.start();
  process.stdout.write(`Pressh Site (public) listening on http://localhost:${port}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runFromEnv();
}
