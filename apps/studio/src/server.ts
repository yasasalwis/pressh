import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import {
  createAuthService,
  createCsrf,
  createFileAuditLog,
  createFileSystemStorage,
} from "@pressh/core";
import { createContentService, createThemeService } from "@pressh/engine";
import { createStudioApp } from "./app.js";
import { createMediaService } from "./media.js";

export interface StudioServerOptions {
  contentRoot: string;
  mediaRoot: string;
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

  const app = createStudioApp({
    auth,
    content,
    media,
    theme,
    csrf,
    storage,
    ...(opts.production !== undefined ? { production: opts.production } : {}),
  });

  return {
    start: () => {
      serve({ fetch: app.fetch, port: opts.port ?? 4000 });
    },
  };
}
