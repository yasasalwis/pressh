import type {PersistedStorageConfig, SecretsBackend, StorageAdapter, StorageFactory} from "@pressh/core";
import {resolveStorage, resolveStoragePath} from "@pressh/core";
import {createSqliteStorage} from "@pressh/adapter-sqlite";
import {createPostgresStorage} from "@pressh/adapter-postgres";
import {createMysqlStorage} from "@pressh/adapter-mysql";
import {createMongoStorage} from "@pressh/adapter-mongo";

/**
 * Backend → adapter factory map. The app layer owns the database drivers so
 * core/engine stay driver-free. The connection string for DB backends arrives
 * as `credential` (resolved from the sealed vault by `resolveStorage`); only the
 * non-secret options (sqlite `path`, mongo `database`) come from `storage.json`.
 * The sqlite `path` is resolved against `baseDir` (the data directory) so it is
 * cwd-independent and identical across the Studio/Site processes and restarts.
 */
export const STORAGE_FACTORIES: Record<string, StorageFactory> = {
    sqlite: (c) => createSqliteStorage({path: resolveStoragePath(c["baseDir"] as string | undefined, String(c["path"]))}),
  postgres: (c) => createPostgresStorage({ connectionString: String(c["credential"]) }),
  mysql: (c) => createMysqlStorage({ uri: String(c["credential"]) }),
  mongo: (c) =>
    createMongoStorage({
      url: String(c["credential"]),
      ...(typeof c["database"] === "string" ? { database: c["database"] } : {}),
    }),
};

export function buildStorage(
  persisted: PersistedStorageConfig | null,
  contentRoot: string,
  secrets: SecretsBackend | undefined,
  baseDir?: string,
): Promise<StorageAdapter> {
    return resolveStorage({persisted, contentRoot, secrets, factories: STORAGE_FACTORIES, baseDir});
}
