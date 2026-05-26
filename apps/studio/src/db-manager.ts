import {copyFile, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import type {
  AuditLog,
  Page,
  PersistedStorageConfig,
  SecretsBackend,
  StorageAdapter,
  StorageBackend,
  StorageConfig,
  StorageFactory,
  StoredDoc,
} from "@pressh/core";
import {
  createBackup,
  createFileSystemStorage,
  createStorageFromConfig,
  loadStorageConfig,
  migrateStorage,
  PressError,
  resolveStoragePath,
  saveStorageConfig,
} from "@pressh/core";
import type {MigrationLock} from "./migration-lock.js";

const SETTINGS_COLLECTION = "settings";
const SETTINGS_DOC = "general";
const COUNT_PAGE = 500;

/** A field the connector needs from the operator (rendered as a form input). */
export interface ConnectorField {
  key: string;
  label: string;
  placeholder?: string;
  /** Secret values are sealed in the vault and never returned to the client. */
  secret: boolean;
  required: boolean;
  /** `credential` → the sealed connection string; `option` → non-secret `storage.json` option. */
  target: "credential" | "option";
}

export interface ConnectorInfo {
  backend: StorageBackend;
  label: string;
  description: string;
  /** True for backends whose credentials must be sealed in the vault. */
  requiresVault: boolean;
  fields: ConnectorField[];
}

/** Static connector catalogue shown on the Database Manager page. */
export const CONNECTORS: ConnectorInfo[] = [
  {
    backend: "fs",
    label: "File (default)",
    description: "Filesystem JSON store with a SQLite index. Zero configuration; great for most sites.",
    requiresVault: false,
    fields: [],
  },
  {
    backend: "sqlite",
    label: "SQLite",
    description: "A single embedded SQLite database file. Simple, fast, no server to run.",
    requiresVault: false,
    fields: [
      {
        key: "path",
        label: "Database file path",
        placeholder: "pressh.sqlite (relative paths are stored in the data directory)",
        secret: false,
        required: true,
        target: "option",
      },
    ],
  },
  {
    backend: "postgres",
    label: "PostgreSQL",
    description: "Connect to a PostgreSQL server. Recommended when the site outgrows file storage.",
    requiresVault: true,
    fields: [
      {
        key: "connectionString",
        label: "Connection string",
        placeholder: "postgres://user:password@host:5432/pressh",
        secret: true,
        required: true,
        target: "credential",
      },
    ],
  },
  {
    backend: "mysql",
    label: "MySQL / MariaDB",
    description: "Connect to a MySQL or MariaDB server.",
    requiresVault: true,
    fields: [
      {
        key: "uri",
        label: "Connection URI",
        placeholder: "mysql://user:password@host:3306/pressh",
        secret: true,
        required: true,
        target: "credential",
      },
    ],
  },
  {
    backend: "mongo",
    label: "MongoDB",
    description: "Connect to a MongoDB deployment (Atlas or self-hosted).",
    requiresVault: true,
    fields: [
      {
        key: "url",
        label: "Connection URL",
        placeholder: "mongodb://user:password@host:27017",
        secret: true,
        required: true,
        target: "credential",
      },
      {
        key: "database",
        label: "Database name",
        placeholder: "pressh",
        secret: false,
        required: false,
        target: "option",
      },
    ],
  },
];

function connector(backend: StorageBackend): ConnectorInfo {
  const found = CONNECTORS.find((c) => c.backend === backend);
  if (!found) throw new PressError("validation", `Unknown storage backend: ${backend}`);
  return found;
}

/** Turns a raw driver open/connect failure into an actionable operator message. */
function connectionErrorMessage(backend: StorageBackend, resolvedPath: string | null, cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : String(cause);
  if (backend === "sqlite") {
    return (
        `Could not open the SQLite database${resolvedPath ? ` at "${resolvedPath}"` : ""}. ` +
        `The path is confined to the data directory (a value like "pressh.sqlite" or "db/pressh.sqlite" ` +
        `is stored there); a path that points outside the data directory is rejected. ` +
        `Make sure the location is writable. (${reason})`
    );
  }
  const label = CONNECTORS.find((c) => c.backend === backend)?.label ?? backend;
  return `Could not connect to ${label}. Check the connection details and that the server is reachable. (${reason})`;
}

export type MigrationPhase =
  | "idle"
  | "testing"
  | "locking"
  | "copying"
  | "verifying"
  | "backing-up"
  | "cutover"
  | "awaiting-restart"
  | "done"
  | "failed";

export interface MigrationRunView {
  id: string;
  from: StorageBackend;
  to: StorageBackend;
  phase: MigrationPhase;
  collections: number;
  records: number;
  backupPath: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Marker persisted across the cutover restart so the old store can be removed afterward. */
interface PreviousStoreMarker {
  config: PersistedStorageConfig;
  backupPath: string | null;
  autoRemove: boolean;
  completedAt: string;
  /** Records copied during the migration; cleanup verifies the new store holds at
   *  least this many before destroying the old one. */
  expectedRecords: number;
}

export interface DbStatus {
  active: PersistedStorageConfig;
  vaultConfigured: boolean;
  connectors: ConnectorInfo[];
  migration: MigrationRunView | null;
  /** Set when a previous store is retained after a cutover and can be removed. */
  pendingCleanup: { backend: StorageBackend; backupPath: string | null; autoRemove: boolean } | null;
}

export interface StartMigrationInput {
  backend: StorageBackend;
  /** Form values keyed by connector field key. */
  values: Record<string, string>;
  /** Remove the previous store automatically after a verified cutover (default true). */
  removeOld?: boolean;
}

export interface DbManagerService {
  status(): Promise<DbStatus>;
  testConnection(input: { backend: StorageBackend; values: Record<string, string> }): Promise<{ ok: true }>;
  startMigration(actorId: string, input: StartMigrationInput): MigrationRunView;
  migrationStatus(): MigrationRunView | null;

  cleanup(actorId: string, options?: { keep?: boolean }): Promise<{ removed: boolean; reason?: string }>;
  /** Resolves when the in-flight migration settles (test helper; no-op when idle). */
  whenSettled(): Promise<void>;
}

export interface DbManagerOptions {
  /** Backend → adapter factory map (the app owns the drivers). */
  factories: Record<string, StorageFactory>;
  /** The live source adapter to migrate FROM. */
  storage: StorageAdapter;
  secrets?: SecretsBackend | undefined;
  audit: AuditLog;
  migrationLock: MigrationLock;
  contentRoot: string;
  mediaRoot: string;
  auditPath: string;
  vaultPath: string;
  storageConfigPath: string;
  /** Directory for pre-migration backups. */
  backupsDir?: string;
  /** Override the wait for the Site's maintenance cache to expire (tests pass 0). */
  maintenancePropagationMs?: number;
  now?: () => number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Maps operator-supplied field values to a resolved StorageConfig for the factory. */
function toStorageConfig(backend: StorageBackend, values: Record<string, string>): {
  config: StorageConfig;
  credential: string | null;
  options: Record<string, unknown>;
} {
  const info = connector(backend);
  const options: Record<string, unknown> = {};
  let credential: string | null = null;
  for (const field of info.fields) {
    const raw = (values[field.key] ?? "").trim();
    if (field.required && raw === "") {
      throw new PressError("validation", `${field.label} is required`);
    }
    if (raw === "") continue;
    if (field.target === "credential") credential = raw;
    else options[field.key] = raw;
  }
  const config: StorageConfig = { backend, ...options };
  if (credential !== null) config["credential"] = credential;
  return { config, credential, options };
}

async function countByCollection(adapter: StorageAdapter): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const cols = await adapter.listCollections();
  if (!cols.ok) throw cols.error;
  for (const collection of cols.value) {
    let cursor: string | null = null;
    let n = 0;
    do {
      const page = await adapter.query<StoredDoc>(collection, {}, {limit: COUNT_PAGE, after: cursor});
      if (!page.ok) throw page.error;
      const value: Page<StoredDoc> = page.value;
      n += value.items.length;
      cursor = value.nextCursor;
    } while (cursor !== null);
    counts.set(collection, n);
  }
  return counts;
}

async function purgeAll(adapter: StorageAdapter): Promise<void> {
  const cols = await adapter.listCollections();
  if (!cols.ok) throw cols.error;
  for (const collection of cols.value) {
    let cursor: string | null = null;
    do {
      const page = await adapter.query<StoredDoc>(collection, {}, {limit: COUNT_PAGE, after: cursor});
      if (!page.ok) throw page.error;
      const value: Page<StoredDoc> = page.value;
      for (const item of value.items) await adapter.delete(collection, item.id);
      cursor = value.nextCursor;
    } while (cursor !== null);
  }
}

export function createDbManager(opts: DbManagerOptions): DbManagerService {
  const backupsDir = opts.backupsDir ?? join(opts.contentRoot, "..", "backups");
  const previousMarkerPath = `${opts.storageConfigPath}.previous`;
  const propagationMs = opts.maintenancePropagationMs ?? 3500;
  const now = opts.now ?? (() => Date.now());
  // Relative backend file paths (sqlite `path`) resolve against the data dir, so
  // the migration target and every later process boot open the SAME file.
  const dataDir = dirname(opts.storageConfigPath);

  let current: MigrationRunView | null = null;
  let runPromise: Promise<void> = Promise.resolve();

  const currentConfig = async (): Promise<PersistedStorageConfig> =>
    (await loadStorageConfig(opts.storageConfigPath)) ?? { backend: "fs" };

  const readMarker = async (): Promise<PreviousStoreMarker | null> => {
    try {
      return JSON.parse(await readFile(previousMarkerPath, "utf8")) as PreviousStoreMarker;
    } catch {
      return null;
    }
  };

  const build = (config: StorageConfig): Promise<StorageAdapter> =>
      Promise.resolve(createStorageFromConfig(config, opts.factories, dataDir));

  // Reads/writes the maintenance flag on a specific store (source before the
  // copy; target after, to clear the flag that copied across as `true`).
  const setMaintenance = async (adapter: StorageAdapter, on: boolean): Promise<void> => {
    const res = await adapter.get<{ id: string; [k: string]: unknown }>(SETTINGS_COLLECTION, SETTINGS_DOC);
    const doc = res.ok && res.value ? res.value : { id: SETTINGS_DOC };
    doc["maintenanceMode"] = on;
    const put = await adapter.put(SETTINGS_COLLECTION, doc);
    if (!put.ok) throw put.error;
  };

  async function backupSource(from: PersistedStorageConfig): Promise<string | null> {
    if (from.backend === "fs") {
      const dest = join(backupsDir, `pre-migration-${now()}`);
      const res = await createBackup(
        {
          contentRoot: typeof from.options?.["root"] === "string" ? (from.options["root"] as string) : opts.contentRoot,
          mediaRoot: opts.mediaRoot,
          vaultPath: opts.vaultPath,
          auditPath: opts.auditPath,
        },
        dest,
      );
      if (!res.ok) throw res.error;
      return dest;
    }
    if (from.backend === "sqlite") {
      const src = String(from.options?.["path"] ?? "");
      if (!src) return null;
      const dest = join(backupsDir, `pre-migration-${now()}`);
      await mkdir(dest, { recursive: true });
      const copied = join(dest, "pressh.sqlite");
      await copyFile(src, copied).catch(() => undefined);
      await copyFile(`${src}-wal`, `${copied}-wal`).catch(() => undefined);
      await copyFile(`${src}-shm`, `${copied}-shm`).catch(() => undefined);
      return dest;
    }
    // External databases can't be file-copied; the old DB is left intact as the
    // rollback artifact until cleanup, which is gated on a healthy restart.
    return null;
  }

  function setRun(patch: Partial<MigrationRunView>): void {
    if (current) current = { ...current, ...patch };
  }

  async function runMigration(actorId: string, input: StartMigrationInput): Promise<void> {
    const from = await currentConfig();
    const removeOld = input.removeOld !== false;
    let target: StorageAdapter | null = null;
    let maintenanceEngaged = false;
    try {
      if (from.backend === input.backend) {
        throw new PressError("conflict", `Pressh is already using the ${input.backend} backend`);
      }
      const { config, credential, options } = toStorageConfig(input.backend, input.values);
      const info = connector(input.backend);
      if (info.requiresVault && !opts.secrets) {
        throw new PressError("validation", "Secrets vault is not configured (set PRESSH_MASTER_KEY) to store database credentials");
      }

      // Reverting to File: copy into the standard content root, or — if a
      // previous file store was retained there — a fresh timestamped root, so the
      // revert never clobbers existing files. The chosen root is persisted only
      // when it differs from the server's default, as an absolute (cwd-safe) path.
      let persistOptions: Record<string, unknown> = options;
      if (input.backend === "fs") {
        let fsRoot = opts.contentRoot;
        const probe = createFileSystemStorage({root: fsRoot});
        const probeCols = await probe.listCollections();
        probe.close();
        if (probeCols.ok && probeCols.value.length > 0) {
          fsRoot = join(dataDir, `content-${now()}`);
          persistOptions = {...options, root: resolve(fsRoot)};
        }
        config.root = fsRoot;
      }

      // 1) Test the target + ensure it is empty (never clobber an in-use DB).
      setRun({ phase: "testing" });
      try {
        target = await build(config);
      } catch (e) {
        const resolved = input.backend === "sqlite" ? resolveStoragePath(dataDir, String(options["path"] ?? "")) : null;
        throw new PressError("validation", connectionErrorMessage(input.backend, resolved, e));
      }
      const existing = await target.listCollections();
      if (!existing.ok) throw existing.error;
      if (existing.value.length > 0) {
        throw new PressError("conflict", "The target database already contains data — use an empty database");
      }

      // 2) Maintenance ON (source) + migration lock so no write is lost.
      setRun({ phase: "locking" });
      opts.migrationLock.lock();
      await setMaintenance(opts.storage, true);
      maintenanceEngaged = true;
      if (propagationMs > 0) await sleep(propagationMs); // let the Site's cache expire

      // 3) Copy every record.
      setRun({ phase: "copying" });
      const copied = await migrateStorage(opts.storage, target);
      if (!copied.ok) throw copied.error;
      setRun({ collections: copied.value.collections, records: copied.value.records });

      // 4) Verify per-collection counts match exactly.
      setRun({ phase: "verifying" });
      const [srcCounts, dstCounts] = await Promise.all([
        countByCollection(opts.storage),
        countByCollection(target),
      ]);
      for (const [collection, n] of srcCounts) {
        if (dstCounts.get(collection) !== n) {
          throw new PressError("internal", `Verification failed for "${collection}": ${dstCounts.get(collection) ?? 0}/${n} records copied`);
        }
      }

      // 5) Seal the credential + back up the old store.
      setRun({ phase: "backing-up" });
      let credentialSecret: string | undefined;
      if (credential !== null && opts.secrets) {
        credentialSecret = `storage.cred.${input.backend}.${now()}`;
        await opts.secrets.setSecret(credentialSecret, credential, "storage");
      }
      const backupPath = await backupSource(from);
      setRun({ backupPath });

      // 6) Cut over: clear maintenance on the NEW store, drop the marker, then
      //    write storage.json (which the watcher detects → restart on the new DB).
      setRun({ phase: "cutover" });
      await setMaintenance(target, false);
      const newConfig: PersistedStorageConfig = {
        backend: input.backend,
        ...(Object.keys(persistOptions).length ? {options: persistOptions} : {}),
        ...(credentialSecret ? { credentialSecret } : {}),
        updatedAt: new Date(now()).toISOString(),
      };
      const marker: PreviousStoreMarker = {
        config: from,
        backupPath,
        autoRemove: removeOld,
        completedAt: new Date(now()).toISOString(),
        expectedRecords: copied.value.records,
      };
      await writeFile(previousMarkerPath, JSON.stringify(marker, null, 2), { mode: 0o600 });
      target.close();
      target = null;
      await saveStorageConfig(opts.storageConfigPath, newConfig);

      await opts.audit.append({
        action: "db.migrate",
        actorId,
        detail: { from: from.backend, to: input.backend, records: current?.records ?? 0 },
      });
      setRun({ phase: "awaiting-restart", finishedAt: new Date(now()).toISOString() });
    } catch (error) {
      // Pre-cutover failure: roll back cleanly — the app keeps running on the old store.
      if (maintenanceEngaged) await setMaintenance(opts.storage, false).catch(() => undefined);
      opts.migrationLock.unlock();
      if (target) target.close();
      const message = error instanceof PressError ? error.message : "Migration failed";
      setRun({ phase: "failed", error: message, finishedAt: new Date(now()).toISOString() });
      await opts.audit
        .append({ action: "db.migrate.failed", actorId, detail: { to: input.backend, error: message } })
        .catch(() => undefined);
    }
  }

  return {
    async status() {
      const active = await currentConfig();
      const marker = await readMarker();
      return {
        active,
        vaultConfigured: opts.secrets !== undefined,
        connectors: CONNECTORS,
        migration: current,
        pendingCleanup: marker
          ? { backend: marker.config.backend, backupPath: marker.backupPath, autoRemove: marker.autoRemove }
          : null,
      };
    },

    async testConnection(input) {
      const info = connector(input.backend);
      if (input.backend === "fs") return { ok: true };
      if (info.requiresVault && !opts.secrets) {
        throw new PressError("validation", "Secrets vault is not configured (set PRESSH_MASTER_KEY) to store database credentials");
      }
      const {config, options} = toStorageConfig(input.backend, input.values);
      const resolved = input.backend === "sqlite" ? resolveStoragePath(dataDir, String(options["path"] ?? "")) : null;
      let adapter: StorageAdapter;
      try {
        adapter = await build(config);
      } catch (e) {
        throw new PressError("validation", connectionErrorMessage(input.backend, resolved, e));
      }
      try {
        const probe = await adapter.listCollections();
        if (!probe.ok) throw new PressError("validation", connectionErrorMessage(input.backend, resolved, probe.error));
        return { ok: true };
      } finally {
        adapter.close();
      }
    },

    startMigration(actorId, input) {
      if (current && (current.phase !== "done" && current.phase !== "failed" && current.phase !== "awaiting-restart")) {
        throw new PressError("conflict", "A migration is already in progress");
      }
      // Validate the backend exists. Same-backend rejection and (for File) the
      // empty-target check happen in the async run once `from` is resolved.
      connector(input.backend);
      current = {
        id: `mig-${now()}`,
        from: "fs",
        to: input.backend,
        phase: "idle",
        collections: 0,
        records: 0,
        backupPath: null,
        error: null,
        startedAt: new Date(now()).toISOString(),
        finishedAt: null,
      };
      // Resolve the real `from` lazily inside the run; report optimistic now.
      void currentConfig().then((c) => setRun({ from: c.backend }));
      runPromise = runMigration(actorId, input);
      return current;
    },

    migrationStatus() {
      return current;
    },

    async cleanup(actorId, options) {
      const marker = await readMarker();
      if (!marker) return { removed: false };
      // "Keep" dismisses the prompt without touching the retained store.
      if (options?.keep) {
        await rm(previousMarkerPath, {force: true});
        return {removed: false};
      }
      // Never destroy the old store until the now-active store is proven to hold
      // the migrated data. `opts.storage` is the backend this (post-restart)
      // process booted on — i.e. the new one. A botched cutover (e.g. the new
      // store came up empty) must not delete the only surviving copy.
      const expected = marker.expectedRecords ?? 0;
      if (expected > 0) {
        let liveTotal = 0;
        try {
          for (const n of (await countByCollection(opts.storage)).values()) liveTotal += n;
        } catch {
          liveTotal = 0;
        }
        if (liveTotal < expected) {
          return {
            removed: false,
            reason:
                `The active database holds ${liveTotal} of ${expected} expected records — keeping the previous store as a safeguard. ` +
                `Make sure Pressh has restarted on the new backend, then try removing it again.`,
          };
        }
      }
      const from = marker.config;
      if (from.backend === "fs") {
        const root = typeof from.options?.["root"] === "string" ? (from.options["root"] as string) : opts.contentRoot;
        await rm(root, { recursive: true, force: true });
      } else if (from.backend === "sqlite") {
        const path = String(from.options?.["path"] ?? "");
        if (path) {
          await rm(path, { force: true });
          await rm(`${path}-wal`, { force: true });
          await rm(`${path}-shm`, { force: true });
        }
      } else if (from.credentialSecret && opts.secrets) {
        // External DB: purge its data, then drop the stored credential.
        const cred = await opts.secrets.getSecret(from.credentialSecret).catch(() => null);
        if (cred) {
          const config: StorageConfig = { backend: from.backend, ...(from.options ?? {}), credential: cred };
          const adapter = await build(config);
          try {
            await purgeAll(adapter);
          } finally {
            adapter.close();
          }
        }
        await opts.secrets.deleteSecret(from.credentialSecret).catch(() => undefined);
      }
      await rm(previousMarkerPath, { force: true });
      await opts.audit
        .append({ action: "db.cleanup", actorId, detail: { removed: from.backend } })
        .catch(() => undefined);
      return { removed: true };
    },

    whenSettled() {
      return runPromise;
    },
  };
}
