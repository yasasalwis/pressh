import {PressError} from "../errors.js";
import type {Result} from "../result.js";
import {err, ok} from "../result.js";
import {createFileSystemStorage} from "./fs-adapter.js";
import type {Page, StorageAdapter, StoredDoc} from "./types.js";

function take<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/**
 * Copies every record from one StorageAdapter to another (e.g. FS → Postgres).
 * Works across any pair of adapters since both implement the same interface.
 */
export async function migrateStorage(
  from: StorageAdapter,
  to: StorageAdapter,
): Promise<Result<{ collections: number; records: number }>> {
  try {
    const collections = take(await from.listCollections());
    let records = 0;
    for (const collection of collections) {
      let cursor: string | null = null;
      do {
        const page: Page<StoredDoc> = take(
          await from.query<StoredDoc>(collection, {}, { limit: 500, after: cursor }),
        );
        for (const doc of page.items) {
          take(await to.put(collection, doc));
          records += 1;
        }
        cursor = page.nextCursor;
      } while (cursor !== null);
    }
    return ok({ collections: collections.length, records });
  } catch (e) {
    return err(e instanceof PressError ? e : new PressError("internal", "Migration failed"));
  }
}

export interface StorageConfig {
  backend: string;
  root?: string;
    /** Directory that relative backend file paths resolve against (set by the resolver). */
    baseDir?: string;
  [key: string]: unknown;
}

export type StorageFactory = (config: StorageConfig) => StorageAdapter | Promise<StorageAdapter>;

/**
 * Config-driven backend selection. `fs` is built in; database backends are
 * supplied via `factories` (so core stays decoupled from the adapter packages).
 * `baseDir`, when given, is forwarded in the config so a factory can resolve its
 * relative file path against the data directory rather than the process `cwd`.
 */
export async function createStorageFromConfig(
  config: StorageConfig,
  factories: Record<string, StorageFactory> = {},
  baseDir?: string,
): Promise<StorageAdapter> {
  if (config.backend === "fs") {
    return createFileSystemStorage({ root: config.root ?? "./content" });
  }
  const factory = factories[config.backend];
  if (!factory) throw new PressError("validation", `Unknown storage backend: ${config.backend}`);
    return factory(baseDir !== undefined ? {...config, baseDir} : config);
}
