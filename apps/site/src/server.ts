import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import {
  MASTER_KEY_BYTES,
  createFileAuditLog,
  createFileSecretsBackend,
  deriveMasterKey,
  loadStorageConfig,
  watchStorageConfig,
} from "@pressh/core";
import type { SecretsBackend } from "@pressh/core";
import {
  createContentService,
  createGdprService,
  createQueryResolver,
  createThemeService,
} from "@pressh/engine";
import { PluginHost, createCveService, createPluginStateStore } from "@pressh/runtime";
import { createSiteApp } from "./app.js";
import { createRenderCache } from "./cache.js";
import { buildStorage } from "./storage.js";

const MASTER_KEY_SALT = Buffer.from("pressh.secrets.v1");

/** Parse the operator master key (hex/base64/passphrase). Mirrors the Studio. */
function parseMasterKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value === "") return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const b64 = Buffer.from(value, "base64");
  if (b64.length === MASTER_KEY_BYTES) return b64;
  return deriveMasterKey(value, MASTER_KEY_SALT);
}

export interface SiteServerOptions {
  contentRoot: string;
  auditPath?: string;
  port?: number;
  baseUrl?: string;
  production?: boolean;
  /** User-installed plugins folder (third-party). */
  pluginsDir?: string;
  /** First-party plugins shipped with Pressh. */
  builtinsDir?: string;
  /** 32-byte vault master key. Required to resolve DB-backend credentials. */
  masterKey?: Buffer;
  /** Path to the sealed secrets vault file. Defaults next to the content root. */
  secretsPath?: string;
  /** Path to the active-storage config (`storage.json`). Defaults next to the content root. */
  storageConfigPath?: string;
}

async function registerPluginsFrom(host: PluginHost, dir: string, builtin: boolean): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await host.register(join(dir, entry.name), { builtin }).catch(() => undefined);
    }
  }
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
  // Vault first: DB backends resolve their connection string from it. Optional
  // when running on the filesystem default (no credentials needed).
  let secrets: SecretsBackend | undefined;
  if (opts.masterKey) {
    secrets = await createFileSecretsBackend({
      path: opts.secretsPath ?? join(opts.contentRoot, "..", "vault.json"),
      key: opts.masterKey,
    });
  }
  const storageConfigPath = opts.storageConfigPath ?? join(opts.contentRoot, "..", "storage.json");
  const persistedStorage = await loadStorageConfig(storageConfigPath);
  const storage = await buildStorage(persistedStorage, opts.contentRoot, secrets);

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
  // Same enabled-set as the Studio (shared storage): the Site spawns only the
  // plugins the operator turned on, so the public process stays lean too.
  const pluginState = createPluginStateStore(storage);
  const pluginHost = new PluginHost({ storage, audit, allowUnsigned: !opts.production, cve, state: pluginState });
  if (opts.builtinsDir) await registerPluginsFrom(pluginHost, opts.builtinsDir, true);
  if (opts.pluginsDir) await registerPluginsFrom(pluginHost, opts.pluginsDir, false);

  // Short-TTL cache over the shared enabled-state so a Studio-side disable takes
  // effect on the public side within seconds, without a read on every request.
  const enabledCache = new Map<string, { value: boolean; at: number }>();
  const ENABLED_TTL_MS = 5000;
  const isPluginEnabled = async (name: string): Promise<boolean> => {
    const hit = enabledCache.get(name);
    const now = Date.now();
    if (hit && now - hit.at < ENABLED_TTL_MS) return hit.value;
    const value = await pluginState.isEnabled(name);
    enabledCache.set(name, { value, at: now });
    return value;
  };
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

  // dist/client/ sits next to dist/server.js in the compiled output.
  const clientDir = fileURLToPath(new URL("client", import.meta.url));

  const app = createSiteApp({
    resolver,
    pluginHost,
    isPluginEnabled,
    cache,
    themeService,
    gdpr,
    storage,
    listPublishedPaths,
    clientDir,
    ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.production !== undefined ? { production: opts.production } : {}),
  });

  return {
    start: () => {
      const port = opts.port ?? 3000;
      const server = serve({ fetch: app.fetch, port });
      server.on("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE") {
          process.stderr.write(
            `\nPressh Site: port ${port} is already in use — is the Site already running?\n` +
              `Stop it (macOS/Linux: lsof -ti:${port} | xargs kill) or set PRESSH_SITE_PORT to a free port.\n`,
          );
          process.exit(1);
        }
        throw e;
      });
      // A Database-Manager cutover rewrites `storage.json`; exit cleanly so the
      // supervisor restarts the Site on the new backend (same as the Studio).
      watchStorageConfig(storageConfigPath, () => {
        process.stdout.write("Pressh Site: storage config changed — restarting to apply the new database.\n");
        void server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
      });
    },
    cache,
  };
}

/** Start the Site from environment variables when run directly (`node dist/server.js`). */
async function runFromEnv(): Promise<void> {
  const port = Number(process.env["PRESSH_SITE_PORT"] ?? 3000);
  const masterKey = parseMasterKey(process.env["PRESSH_MASTER_KEY"]);
  const server = await createSiteServer({
    contentRoot: process.env["PRESSH_CONTENT_ROOT"] ?? "./data/content",
    port,
    production: process.env["NODE_ENV"] === "production",
    ...(process.env["PRESSH_BASE_URL"] ? { baseUrl: process.env["PRESSH_BASE_URL"] } : {}),
    ...(process.env["PRESSH_PLUGINS_DIR"] ? { pluginsDir: process.env["PRESSH_PLUGINS_DIR"] } : {}),
    ...(masterKey ? { masterKey } : {}),
    ...(process.env["PRESSH_STORAGE_CONFIG"] ? { storageConfigPath: process.env["PRESSH_STORAGE_CONFIG"] } : {}),
    builtinsDir: process.env["PRESSH_BUILTINS_DIR"] ?? join(process.cwd(), "builtins"),
  });
  server.start();
  process.stdout.write(`Pressh Site (public) listening on http://localhost:${port}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFromEnv().catch((e: unknown) => {
    process.stderr.write(`Pressh Site failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
