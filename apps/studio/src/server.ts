import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {readdir} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {serve} from "@hono/node-server";
import {
    createAuthService,
    createCsrf,
    createFileAuditLog,
    createMemberAuthService,
    createRedirectService,
    createScheduler,
    listBackups,
    PressError,
    runScheduledBackup,
    verifyBackup,
    watchStorageConfig,
} from "@pressh/core";
import type {BackupTargets} from "@pressh/core";
import {STORAGE_FACTORIES} from "./storage.js";
import {hasMasterSecret, openConfiguredStorage} from "./bootstrap.js";
import {
  createContentService,
  createGdprService,
  createSettingsService,
  createThemeService,
  PUBLISH_JOB_TYPE,
} from "@pressh/engine";
import type {CveFeedSource} from "@pressh/runtime";
import {createCveService, createPluginStateStore, PluginHost} from "@pressh/runtime";
import type {BackupAdmin, PanelProvider, PluginControlProvider, PluginInfoProvider} from "./app.js";
import {createStudioApp, seedDemoContent} from "./app.js";
import {createMediaService} from "./media.js";
import {createMigrationLock} from "./migration-lock.js";
import {createDbManager} from "./db-manager.js";

/** Registers every plugin folder under `dir` without spawning workers; the state
 * store decides which actually start. Per-plugin failures are swallowed so one
 * bad plugin can't take down boot. */
async function registerPluginsFrom(host: PluginHost, dir: string, builtin: boolean): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // directory absent — nothing to register
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await host.register(join(dir, entry.name), { builtin }).catch(() => undefined);
    }
  }
}

/**
 * Exit code used after a Database-Manager cutover so the process supervisor
 * restarts us on the new backend. `scripts/run.mjs` treats this code as
 * "respawn me" rather than "tear the whole app down". Keep in sync with the
 * matching constant in `apps/site/src/server.ts` and `scripts/run.mjs`.
 */
const STORAGE_RESTART_EXIT_CODE = 75;

export interface StudioServerOptions {
  contentRoot: string;
  mediaRoot: string;
  /** User-installed plugins folder (third-party). */
  pluginsDir?: string;
  /** First-party plugins shipped with Pressh; registered as `builtin`. */
  builtinsDir?: string;
  auditPath?: string;
  port?: number;
  production?: boolean;
  csrfSecret?: string;
    /** Raw `PRESSH_MASTER_KEY` (32-byte hex/base64 key or passphrase). When set, SMTP credentials can be sealed. */
    masterSecret?: string;
    /** Raw master-key string used to derive the plugin-signing key (see PluginHost). */
    signingSecret?: string;
  /** Path to the sealed secrets vault file. Defaults next to the content root. */
  secretsPath?: string;
  /** Path to the active-storage config (`storage.json`). Defaults next to the content root. */
  storageConfigPath?: string;
  /** Source of plugin CVE advisories (v1 default: empty/operator-supplied). */
  cveFeed?: CveFeedSource;
    /**
     * Path to the plugin-worker entry script. Defaults (dev) to the runtime's
     * compiled `worker-entry.js`. The standalone `.pressh/` build sets it to
     * `.pressh/<app>/runtime/worker-entry.js` so the worker's fs-read sandbox is
     * scoped to that code-only dir instead of the whole app bundle dir.
     */
    workerScript?: string;
}

/**
 * Wires the Studio (admin) process — the trust-boundary counterpart to the Site
 * process (ADR-002). Boots its own storage/auth/content/media + CSRF.
 */
export async function createStudioServer(opts: StudioServerOptions): Promise<{ start: () => void }> {
    // Open the backend selected by `storage.json` (a DB or the filesystem
    // default) together with the secrets vault — via the shared helper the seed/
    // admin CLIs also use, so a configured database holds ALL persisted data.
    const {storage, secrets, vaultPath, storageConfigPath} = await openConfiguredStorage({
        contentRoot: opts.contentRoot,
        ...(opts.storageConfigPath ? {storageConfigPath: opts.storageConfigPath} : {}),
        ...(opts.secretsPath ? {secretsPath: opts.secretsPath} : {}),
        ...(opts.masterSecret ? {masterSecret: opts.masterSecret} : {}),
    });

  const auditPath = opts.auditPath ?? join(opts.contentRoot, "..", "audit.log");
    const audit = await createFileAuditLog({
        path: auditPath,
        ...(opts.signingSecret ? {sealSecret: opts.signingSecret} : {}),
    });
    const auth = await createAuthService({storage, audit, ...(secrets ? {secrets} : {})});
    // Site members live in shared storage; the Studio manages them (list/suspend/erase).
    const memberAuth = await createMemberAuthService({storage, audit});
    const redirects = createRedirectService({storage, audit});
  const scheduler = createScheduler({ storage, audit });
    const content = createContentService({storage, audit, scheduler, ...(secrets ? {secrets} : {})});
  scheduler.register(PUBLISH_JOB_TYPE, async (payload) => {
    const entryId = (payload as { entryId?: string }).entryId;
    if (entryId) {
      await content.transition(["content.publish"], entryId, "published").catch(() => undefined);
    }
  });

    // Scheduled offsite backups (RUNBOOK DR). Deploy-time config: point
    // PRESSH_BACKUP_DIR at a mounted offsite volume. Runs ONLY on the Studio
    // (the Site has no scheduler) so backups never double-run. The job
    // re-schedules itself, forming a single recurring chain that survives restarts.
    const BACKUP_JOB = "backup.run";
    const backupDir = process.env["PRESSH_BACKUP_DIR"]?.trim() || "";
    const backupKeep = Math.max(1, Number(process.env["PRESSH_BACKUP_KEEP"] ?? 7) || 7);
    const backupIntervalMs = Math.max(
        60_000,
        Number(process.env["PRESSH_BACKUP_INTERVAL_MS"] ?? 24 * 60 * 60 * 1000) || 24 * 60 * 60 * 1000,
    );
    const backupTargets: BackupTargets = {
        contentRoot: opts.contentRoot,
        mediaRoot: opts.mediaRoot,
        vaultPath,
        auditPath,
    };
    let backups: BackupAdmin | undefined;
    if (backupDir) {
        scheduler.register(BACKUP_JOB, async () => {
            const r = await runScheduledBackup({targets: backupTargets, backupDir, keep: backupKeep});
            await audit.append(
                r.ok
                    ? {
                        action: "backup.run",
                        actorId: null,
                        detail: {name: r.value.name, items: r.value.items, pruned: r.value.pruned}
                    }
                    : {action: "backup.failed", actorId: null, detail: {error: r.error.message}},
            );
            // Always chain the next run so one failure can't stop scheduled backups.
            await scheduler.schedule({type: BACKUP_JOB, runAt: Date.now() + backupIntervalMs});
        });
        backups = {
            dir: backupDir,
            intervalMs: backupIntervalMs,
            keep: backupKeep,
            run: async () => {
                const r = await runScheduledBackup({targets: backupTargets, backupDir, keep: backupKeep});
                if (!r.ok) throw r.error;
                await audit.append({action: "backup.run", actorId: null, detail: {...r.value, manual: true}});
                return r.value;
            },
            list: async () => {
                const r = await listBackups(backupDir);
                if (!r.ok) throw r.error;
                return r.value.map((b) => ({name: b.name, createdAt: b.createdAt, sizeBytes: b.sizeBytes}));
            },
            verify: async (name) => {
                const listed = await listBackups(backupDir);
                if (!listed.ok) throw listed.error;
                const target = name ? listed.value.find((b) => b.name === name) : listed.value[0];
                if (!target) throw new PressError("not_found", "No backup available to verify");
                const v = await verifyBackup(target.path);
                if (!v.ok) throw v.error;
                await audit.append({
                    action: "backup.verify",
                    actorId: null,
                    detail: {name: target.name, ok: v.value.ok}
                });
                return v.value;
            },
        };
    }

  scheduler.start();

    // Boot-schedule a single recurring backup chain if none is pending yet.
    if (backupDir && !(await scheduler.pending()).some((j) => j.type === BACKUP_JOB)) {
        await scheduler.schedule({type: BACKUP_JOB, runAt: Date.now() + backupIntervalMs});
    }
  const media = createMediaService({ storage, audit, mediaRoot: opts.mediaRoot });
  const theme = createThemeService({ storage, audit });

  const settings = createSettingsService({ storage, audit, ...(secrets ? { secrets } : {}) });

  const gdpr = createGdprService({
    storage,
    audit,
      // Secrets let GDPR export reveal sealed PII (e.g. encrypted form fields).
      ...(secrets ? {secrets} : {}),
    scopes: [
      { collection: "form_submissions", subjectField: "subjectRef", timestampField: "at" },
      { collection: "media", subjectField: "ownerRef" },
        // Storefront orders carry customer PII (name/email/address). `subjectRef`
        // is the lowercased customer email; `createdAt` enables a retention policy.
        {collection: "inventory_orders", subjectField: "subjectRef", timestampField: "createdAt"},
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
  // The state store decides which registered plugins actually spawn a worker —
  // disabled ones (the default) cost nothing.
  const pluginState = createPluginStateStore(storage);
    const pluginHost = new PluginHost({
        storage,
        audit,
        allowUnsigned: !opts.production,
        cve,
        state: pluginState,
        // Gated PII primitives for plugins (parity with the Site host).
        pii: gdpr,
        ...(opts.signingSecret ? {signingSecret: opts.signingSecret} : {}),
        ...(opts.workerScript ? {workerScript: opts.workerScript} : {}),
    });
  if (opts.builtinsDir) await registerPluginsFrom(pluginHost, opts.builtinsDir, true);
  if (opts.pluginsDir) await registerPluginsFrom(pluginHost, opts.pluginsDir, false);

  const panels: PanelProvider = {
    list: async () => pluginHost.panels(),
    get: (plugin) => pluginHost.panel(plugin),
  };
  const pluginInfo: PluginInfoProvider = {
    list: async () => pluginHost.plugins(),
  };
  const pluginControl: PluginControlProvider = {
    isRegistered: (name) => pluginHost.isRegistered(name),
    enable: (name) => pluginHost.enable(name),
    disable: (name) => pluginHost.disable(name),
    panelActions: (name) => pluginHost.panelActions(name),
    invoke: (name, action, payload) => pluginHost.invoke(name, action, payload),
    designerPresets: () => pluginHost.designerPresets(),
  };

  const migrationLock = createMigrationLock();
  const dbManager = createDbManager({
    factories: STORAGE_FACTORIES,
    storage,
    secrets,
    audit,
    migrationLock,
    contentRoot: opts.contentRoot,
    mediaRoot: opts.mediaRoot,
    auditPath,
    vaultPath,
    storageConfigPath,
  });

  const app = createStudioApp({
    auth,
    content,
    media,
    theme,
    csrf,
    storage,
    audit,
    settings,
      memberAuth,
      redirects,
      ...(backups ? {backups} : {}),
      ...(secrets ? {secrets} : {}),
    panels,
    pluginInfo,
    pluginControl,
    gdpr,
    cve,
    migrationLock,
    dbManager,
    ...(opts.production !== undefined ? { production: opts.production } : {}),
  });

  // Seed demo content on startup if the home page doesn't exist yet.
  // Runs silently — slug conflicts for already-existing pages are swallowed.
  const usersPage = await storage.query<{ id: string }>("users");
  const authorId =
    usersPage.ok && usersPage.value.items.length > 0
      ? (usersPage.value.items[0]?.id ?? "system-seed")
      : null;
  if (authorId) {
    const homeEntry = await content.resolveBySlug("home").catch(() => null);
    if (!homeEntry) {
      await seedDemoContent(content, authorId, ["*"]).catch(() => {});
    }
    // Always ensure header/footer system pages exist (idempotent).
    await content.ensureSystemPages(authorId).catch(() => {});
  }

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
      // Database-Manager cutover writes a new `storage.json`; exit cleanly so the
      // process supervisor (Docker/systemd/pm2) restarts us on the new backend.
      watchStorageConfig(storageConfigPath, () => {
        process.stdout.write("Pressh Studio: storage config changed — restarting to apply the new database.\n");
        void server.close(() => process.exit(STORAGE_RESTART_EXIT_CODE));
        setTimeout(() => process.exit(STORAGE_RESTART_EXIT_CODE), 3000).unref();
      });
    },
  };
}

/** Start the Studio from environment variables when run directly (`node dist/server.js`). */
async function runFromEnv(): Promise<void> {
  const port = Number(process.env["PRESSH_STUDIO_PORT"] ?? 4000);
  const production = process.env["NODE_ENV"] === "production";
    const masterSecret = process.env["PRESSH_MASTER_KEY"]?.trim() || undefined;
    if (production && !hasMasterSecret(masterSecret)) {
    throw new Error(
      "PRESSH_MASTER_KEY is required in production (32-byte hex/base64 key, or a passphrase). " +
        "It seals the secrets vault used for SMTP credentials.",
    );
  }
  const server = await createStudioServer({
    contentRoot: process.env["PRESSH_CONTENT_ROOT"] ?? "./data/content",
    mediaRoot: process.env["PRESSH_MEDIA_ROOT"] ?? "./data/media",
    port,
    production,
      ...(masterSecret ? {masterSecret} : {}),
      ...(process.env["PRESSH_MASTER_KEY"] ? {signingSecret: process.env["PRESSH_MASTER_KEY"]} : {}),
    ...(process.env["PRESSH_CSRF_SECRET"] ? { csrfSecret: process.env["PRESSH_CSRF_SECRET"] } : {}),
    ...(process.env["PRESSH_PLUGINS_DIR"] ? { pluginsDir: process.env["PRESSH_PLUGINS_DIR"] } : {}),
    ...(process.env["PRESSH_STORAGE_CONFIG"] ? { storageConfigPath: process.env["PRESSH_STORAGE_CONFIG"] } : {}),
      ...(process.env["PRESSH_WORKER_SCRIPT"] ? {workerScript: process.env["PRESSH_WORKER_SCRIPT"]} : {}),
    builtinsDir: process.env["PRESSH_BUILTINS_DIR"] ?? join(process.cwd(), "builtins"),
  });
  server.start();
  process.stdout.write(`Pressh Studio (admin) listening on http://localhost:${port}/admin\n`);
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
    process.stderr.write(`Pressh Studio failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
