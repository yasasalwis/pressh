import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import {
  createAuthService,
  createCsrf,
  createFileAuditLog,
  createFileSystemStorage,
  createScheduler,
} from "@pressh/core";
import {
  PUBLISH_JOB_TYPE,
  createContentService,
  createGdprService,
  createThemeService,
} from "@pressh/engine";
import { PluginHost, createCveService } from "@pressh/runtime";
import type { CveFeedSource } from "@pressh/runtime";
import { createStudioApp } from "./app.js";
import type { PanelProvider } from "./app.js";
import { createMediaService } from "./media.js";

export interface StudioServerOptions {
  contentRoot: string;
  mediaRoot: string;
  pluginsDir?: string;
  auditPath?: string;
  port?: number;
  production?: boolean;
  csrfSecret?: string;
  /** Source of plugin CVE advisories (v1 default: empty/operator-supplied). */
  cveFeed?: CveFeedSource;
}

/**
 * Wires the Studio (admin) process — the trust-boundary counterpart to the Site
 * process (ADR-002). Boots its own storage/auth/content/media + CSRF.
 */
export async function createStudioServer(opts: StudioServerOptions): Promise<{ start: () => void }> {
  const storage = createFileSystemStorage({ root: opts.contentRoot });
  const audit = await createFileAuditLog({
    path: opts.auditPath ?? join(opts.contentRoot, "..", "audit.log"),
  });
  const auth = await createAuthService({ storage, audit });
  const scheduler = createScheduler({ storage, audit });
  const content = createContentService({ storage, audit, scheduler });
  scheduler.register(PUBLISH_JOB_TYPE, async (payload) => {
    const entryId = (payload as { entryId?: string }).entryId;
    if (entryId) {
      await content.transition(["content.publish"], entryId, "published").catch(() => undefined);
    }
  });
  scheduler.start();
  const media = createMediaService({ storage, audit, mediaRoot: opts.mediaRoot });
  const theme = createThemeService({ storage, audit });
  const gdpr = createGdprService({
    storage,
    audit,
    scopes: [
      { collection: "form_submissions", subjectField: "subjectRef", timestampField: "at" },
      { collection: "media", subjectField: "ownerRef" },
    ],
  });
  const csrfSecret = opts.csrfSecret
    ? Buffer.from(opts.csrfSecret)
    : randomBytes(32);
  const csrf = createCsrf(csrfSecret);

  const cve = createCveService({
    storage,
    audit,
    source: opts.cveFeed ?? { fetch: async () => [] },
  });
  scheduler.register("cve.sync", async () => {
    await cve.sync();
  });
  await scheduler.schedule({ type: "cve.sync" }); // initial sync on boot

  // The Studio boots its own PluginHost (separate trust boundary, ADR-002).
  const pluginHost = new PluginHost({ storage, audit, allowUnsigned: !opts.production, cve });
  if (opts.pluginsDir) {
    const entries = await readdir(opts.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await pluginHost.load(join(opts.pluginsDir, entry.name)).catch(() => undefined);
      }
    }
  }
  const panels: PanelProvider = {
    list: async () => pluginHost.panels(),
    get: (plugin) => pluginHost.panel(plugin),
  };

  const app = createStudioApp({
    auth,
    content,
    media,
    theme,
    csrf,
    storage,
    panels,
    gdpr,
    cve,
    ...(opts.production !== undefined ? { production: opts.production } : {}),
  });

  return {
    start: () => {
      const port = opts.port ?? 4000;
      const server = serve({ fetch: app.fetch, port });
      server.on("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE") {
          process.stderr.write(
            `\nPressh Studio: port ${port} is already in use — is the Studio already running?\n` +
              `Stop it (macOS/Linux: lsof -ti:${port} | xargs kill) or set PRESSH_STUDIO_PORT to a free port.\n`,
          );
          process.exit(1);
        }
        throw e;
      });
    },
  };
}

/** Start the Studio from environment variables when run directly (`node dist/server.js`). */
async function runFromEnv(): Promise<void> {
  const port = Number(process.env["PRESSH_STUDIO_PORT"] ?? 4000);
  const server = await createStudioServer({
    contentRoot: process.env["PRESSH_CONTENT_ROOT"] ?? "./data/content",
    mediaRoot: process.env["PRESSH_MEDIA_ROOT"] ?? "./data/media",
    port,
    production: process.env["NODE_ENV"] === "production",
    ...(process.env["PRESSH_CSRF_SECRET"] ? { csrfSecret: process.env["PRESSH_CSRF_SECRET"] } : {}),
    ...(process.env["PRESSH_PLUGINS_DIR"] ? { pluginsDir: process.env["PRESSH_PLUGINS_DIR"] } : {}),
  });
  server.start();
  process.stdout.write(`Pressh Studio (admin) listening on http://localhost:${port}/admin\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFromEnv().catch((e: unknown) => {
    process.stderr.write(`Pressh Studio failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
