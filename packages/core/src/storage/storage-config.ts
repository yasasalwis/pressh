import {mkdir, readFile, rename, stat, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, join} from "node:path";
import {PressError} from "../errors.js";
import type {SecretsBackend} from "../secrets.js";
import {createFileSystemStorage} from "./fs-adapter.js";
import type {StorageConfig, StorageFactory} from "./migrate.js";
import {createStorageFromConfig} from "./migrate.js";
import type {StorageAdapter} from "./types.js";

/**
 * The active storage backend is persisted OUTSIDE the content store (it cannot
 * live in the store it selects — that store is the very thing a migration
 * replaces). This file (`storage.json`, default next to the content root) holds
 * only non-secret configuration; the connection string (which carries the
 * password) is sealed in the secrets vault and referenced by `credentialSecret`.
 *
 * Both the Studio and Site processes read this at boot to decide which adapter
 * to construct, so a Database-Manager cutover survives a restart.
 */
export const STORAGE_BACKENDS = ["fs", "sqlite", "postgres", "mysql", "mongo"] as const;
export type StorageBackend = (typeof STORAGE_BACKENDS)[number];

export interface PersistedStorageConfig {
  backend: StorageBackend;
  /** Non-secret, backend-specific options (e.g. sqlite `path`, mongo `database`). */
  options?: Record<string, unknown>;
  /** Vault key whose value is the connection string/URI for DB backends. */
  credentialSecret?: string;
  /** ISO timestamp of the last write — informational only. */
  updatedAt?: string;
}

function isBackend(value: unknown): value is StorageBackend {
  return typeof value === "string" && (STORAGE_BACKENDS as readonly string[]).includes(value);
}

/**
 * Resolves a backend's filesystem path against the data directory so it is
 * identical across processes and restarts. A relative path (e.g. "db.sqlite")
 * would otherwise resolve against each process's `cwd` — the Studio and Site run
 * as separate processes and a supervisor may restart them from a different
 * directory, so a relative path could silently point at different (empty) files.
 * Absolute paths and the in-memory marker ":memory:" pass through unchanged.
 */
export function resolveStoragePath(baseDir: string | undefined, path: string): string {
  if (path === ":memory:" || isAbsolute(path) || !baseDir) return path;
  return join(baseDir, path);
}

/** Reads and validates the persisted config. Returns null when the file is absent. */
export async function loadStorageConfig(path: string): Promise<PersistedStorageConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new PressError("internal", `Cannot read storage config: ${String(e)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PressError("validation", "storage.json is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new PressError("validation", "storage.json must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (!isBackend(obj["backend"])) {
    throw new PressError("validation", `storage.json has an unknown backend: ${String(obj["backend"])}`);
  }
  const config: PersistedStorageConfig = { backend: obj["backend"] };
  if (obj["options"] !== undefined) {
    if (typeof obj["options"] !== "object" || obj["options"] === null) {
      throw new PressError("validation", "storage.json `options` must be an object");
    }
    config.options = obj["options"] as Record<string, unknown>;
  }
  if (typeof obj["credentialSecret"] === "string") config.credentialSecret = obj["credentialSecret"];
  if (typeof obj["updatedAt"] === "string") config.updatedAt = obj["updatedAt"];
  return config;
}

/** Atomically persists the config (temp file + rename) so a crash never leaves a half-written file. */
export async function saveStorageConfig(path: string, config: PersistedStorageConfig): Promise<void> {
  if (!isBackend(config.backend)) {
    throw new PressError("validation", `Unknown backend: ${String(config.backend)}`);
  }
  await mkdir(dirname(path), { recursive: true });
  const body = JSON.stringify({ ...config, updatedAt: config.updatedAt ?? new Date().toISOString() }, null, 2);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

export interface ResolveStorageArgs {
  /** The persisted config, or null to fall back to the filesystem default. */
  persisted: PersistedStorageConfig | null;
  /** Default content root used by the `fs` backend. */
  contentRoot: string;
  /** Vault used to resolve `credentialSecret`. Required for DB backends. */
  secrets?: SecretsBackend | undefined;
  /** Backend → adapter factory map (supplied by the app, which owns the drivers). */
  factories: Record<string, StorageFactory>;
  /** Directory that relative backend file paths (e.g. sqlite `path`) resolve against. */
  baseDir?: string | undefined;
}

/**
 * Builds the live StorageAdapter from the persisted config, injecting the sealed
 * connection string from the vault for DB backends. `fs` needs neither factories
 * nor a vault, so the default install works with zero configuration.
 */
export async function resolveStorage(args: ResolveStorageArgs): Promise<StorageAdapter> {
  const p = args.persisted;
  if (!p || p.backend === "fs") {
    const root = typeof p?.options?.["root"] === "string" ? (p.options["root"] as string) : args.contentRoot;
    return createFileSystemStorage({ root });
  }
  const config: StorageConfig = { backend: p.backend, ...(p.options ?? {}) };
  if (p.credentialSecret) {
    if (!args.secrets) {
      throw new PressError(
        "validation",
        "Secrets vault is not configured (set PRESSH_MASTER_KEY) — required to resolve database credentials",
      );
    }
    config["credential"] = await args.secrets.getSecret(p.credentialSecret);
  }
  return createStorageFromConfig(config, args.factories, args.baseDir);
}

/**
 * Polls `storage.json` for changes and fires `onChange` once when it is created
 * or modified after watching began. Polling (not fs.watch) is used deliberately:
 * the file lives on a shared volume that both processes mount, and fs.watch is
 * unreliable across container/bind-mount boundaries. Returns a stop function.
 */
export function watchStorageConfig(
  path: string,
  onChange: () => void,
  intervalMs = 2000,
): () => void {
  let last: number | null = null;
  let ready = false;
  let fired = false;
  let stopped = false;

  const readMtime = async (): Promise<number | null> => {
    try {
      return (await stat(path)).mtimeMs;
    } catch {
      return null;
    }
  };

  // Establish the baseline before comparing, so a slow initial stat can't be
  // mistaken for a change on the first tick.
  void readMtime().then((m) => {
    last = m;
    ready = true;
  });

  const timer = setInterval(() => {
    void readMtime().then((m) => {
      if (stopped || fired || !ready) return;
      // Fire when the file is created (null → present) OR modified (mtime
      // changed). Deletion (present → null) is ignored — never restart on that.
      if (m !== null && m !== last) {
        fired = true;
        clearInterval(timer);
        onChange();
        return;
      }
      last = m;
    });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
