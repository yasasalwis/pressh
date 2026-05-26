import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {readdir} from "node:fs/promises";
import {serve} from "@hono/node-server";
import type {SecretsBackend} from "@pressh/core";
import {
  createFileAuditLog,
  createMemberAuthService,
  loadStorageConfig,
  openSecretsVault,
  watchStorageConfig,
} from "@pressh/core";
import {
  createContentService,
  createEmailService,
  createGdprService,
  createQueryResolver,
  createSettingsService,
  createThemeService,
} from "@pressh/engine";
import {createCveService, createPluginStateStore, PluginHost} from "@pressh/runtime";
import {createMemberRouter} from "./members.js";
import {createSiteApp} from "./app.js";
import {createRenderCache} from "./cache.js";
import {buildStorage} from "./storage.js";

/**
 * Exit code used after a Database-Manager cutover so a supervisor restarts the
 * Site on the new backend. `scripts/run.mjs` treats this code as "respawn me".
 * Keep in sync with `apps/studio/src/server.ts` and `scripts/run.mjs`.
 */
const STORAGE_RESTART_EXIT_CODE = 75;

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
    /** Raw `PRESSH_MASTER_KEY` (32-byte hex/base64 key or passphrase). Resolves DB-backend credentials. */
    masterSecret?: string;
    /** Raw master-key string used to derive the plugin-signing key (see PluginHost). */
    signingSecret?: string;
  /** Path to the sealed secrets vault file. Defaults next to the content root. */
  secretsPath?: string;
  /** Path to the active-storage config (`storage.json`). Defaults next to the content root. */
  storageConfigPath?: string;
    /**
     * Path to the plugin-worker entry script. Defaults (dev) to the runtime's
     * compiled `worker-entry.js`. The standalone `.pressh/` build sets it to
     * `.pressh/<app>/runtime/worker-entry.js` so the worker's fs-read sandbox is
     * scoped to that code-only dir instead of the whole app bundle dir.
     */
    workerScript?: string;
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
    const vaultPath = opts.secretsPath ?? join(opts.contentRoot, "..", "vault.json");
    const secrets: SecretsBackend | undefined =
        (await openSecretsVault({path: vaultPath, secret: opts.masterSecret})) ?? undefined;
  const storageConfigPath = opts.storageConfigPath ?? join(opts.contentRoot, "..", "storage.json");
    // Relative backend file paths resolve against the data directory (not cwd) so
    // the Site opens the exact same sqlite file the Studio migrated into.
    const dataDir = dirname(storageConfigPath);
  const persistedStorage = await loadStorageConfig(storageConfigPath);
    const storage = await buildStorage(persistedStorage, opts.contentRoot, secrets, dataDir);

  const audit = await createFileAuditLog({
    path: opts.auditPath ?? join(opts.contentRoot, "..", "audit.log"),
      ...(opts.signingSecret ? {sealSecret: opts.signingSecret} : {}),
  });
  const content = createContentService({ storage, audit });
  const resolver = createQueryResolver({ content });
  const themeService = createThemeService({ storage, audit });
  const gdpr = createGdprService({
    storage,
    audit,
      scopes: [
          {collection: "form_submissions", subjectField: "subjectRef", timestampField: "at"},
          // Storefront orders carry customer PII; `subjectRef` is the lowercased email.
          {collection: "inventory_orders", subjectField: "subjectRef", timestampField: "createdAt"},
      ],
  });
  // Shares the CVE store the Studio syncs; the Site's host refuses flagged plugins too.
  const cve = createCveService({ storage, audit, source: { fetch: async () => [] } });
  // Same enabled-set as the Studio (shared storage): the Site spawns only the
  // plugins the operator turned on, so the public process stays lean too.
  const pluginState = createPluginStateStore(storage);
    const pluginHost = new PluginHost({
        storage,
        audit,
        allowUnsigned: !opts.production,
        cve,
        state: pluginState,
        ...(opts.signingSecret ? {signingSecret: opts.signingSecret} : {}),
        ...(opts.workerScript ? {workerScript: opts.workerScript} : {}),
    });
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

    const settingsSvc = createSettingsService({storage, audit, ...(secrets ? {secrets} : {})});
    const emailSvc = secrets
        ? createEmailService({settings: settingsSvc, secrets, audit})
        : undefined;
    const memberAuth = await createMemberAuthService({storage, audit});
    const memberRouter = createMemberRouter({
        memberAuth,
        ...(emailSvc ? {email: emailSvc} : {}),
        settings: settingsSvc,
        ...(opts.production !== undefined ? {production: opts.production} : {}),
    });

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
      memberRouter,
      memberAuth,
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
          void server.close(() => process.exit(STORAGE_RESTART_EXIT_CODE));
          setTimeout(() => process.exit(STORAGE_RESTART_EXIT_CODE), 3000).unref();
      });
    },
    cache,
  };
}

/** Start the Site from environment variables when run directly (`node dist/server.js`). */
async function runFromEnv(): Promise<void> {
  const port = Number(process.env["PRESSH_SITE_PORT"] ?? 3000);
    const masterSecret = process.env["PRESSH_MASTER_KEY"]?.trim() || undefined;
  const server = await createSiteServer({
    contentRoot: process.env["PRESSH_CONTENT_ROOT"] ?? "./data/content",
    port,
    production: process.env["NODE_ENV"] === "production",
    ...(process.env["PRESSH_BASE_URL"] ? { baseUrl: process.env["PRESSH_BASE_URL"] } : {}),
    ...(process.env["PRESSH_PLUGINS_DIR"] ? { pluginsDir: process.env["PRESSH_PLUGINS_DIR"] } : {}),
      ...(masterSecret ? {masterSecret} : {}),
      ...(process.env["PRESSH_MASTER_KEY"] ? {signingSecret: process.env["PRESSH_MASTER_KEY"]} : {}),
    ...(process.env["PRESSH_STORAGE_CONFIG"] ? { storageConfigPath: process.env["PRESSH_STORAGE_CONFIG"] } : {}),
      ...(process.env["PRESSH_WORKER_SCRIPT"] ? {workerScript: process.env["PRESSH_WORKER_SCRIPT"]} : {}),
    builtinsDir: process.env["PRESSH_BUILTINS_DIR"] ?? join(process.cwd(), "builtins"),
  });
  server.start();
  process.stdout.write(`Pressh Site (public) listening on http://localhost:${port}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    // Load a project-root .env for local dev. loadEnvFile never overrides vars
    // already in the environment, so a real OS/secret-manager key still wins; a
    // missing file is a no-op.
    try {
        process.loadEnvFile();
    } catch { /* no .env — rely on the real environment */
    }
  runFromEnv().catch((e: unknown) => {
    process.stderr.write(`Pressh Site failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
