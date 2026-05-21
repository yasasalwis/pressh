import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import {
  createAuthService,
  createCsrf,
  createFileAuditLog,
  createFileSystemStorage,
} from "@pressh/core";
import { createContentService, createThemeService } from "@pressh/engine";
import { PluginHost } from "@pressh/runtime";
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
  const content = createContentService({ storage, audit });
  const media = createMediaService({ storage, audit, mediaRoot: opts.mediaRoot });
  const theme = createThemeService({ storage, audit });
  const csrfSecret = opts.csrfSecret
    ? Buffer.from(opts.csrfSecret)
    : randomBytes(32);
  const csrf = createCsrf(csrfSecret);

  // The Studio boots its own PluginHost (separate trust boundary, ADR-002).
  const pluginHost = new PluginHost({ storage, audit, allowUnsigned: !opts.production });
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
    ...(opts.production !== undefined ? { production: opts.production } : {}),
  });

  return {
    start: () => {
      serve({ fetch: app.fetch, port: opts.port ?? 4000 });
    },
  };
}
