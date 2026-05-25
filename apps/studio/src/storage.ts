import { resolveStorage } from "@pressh/core";
import type { PersistedStorageConfig, SecretsBackend, StorageAdapter, StorageFactory } from "@pressh/core";
import { createSqliteStorage } from "@pressh/adapter-sqlite";
import { createPostgresStorage } from "@pressh/adapter-postgres";
import { createMysqlStorage } from "@pressh/adapter-mysql";
import { createMongoStorage } from "@pressh/adapter-mongo";

/**
 * Backend → adapter factory map. The app layer owns the database drivers so
 * core/engine stay driver-free. The connection string for DB backends arrives
 * as `credential` (resolved from the sealed vault by `resolveStorage`); only the
 * non-secret options (sqlite `path`, mongo `database`) come from `storage.json`.
 */
export const STORAGE_FACTORIES: Record<string, StorageFactory> = {
  sqlite: (c) => createSqliteStorage({ path: String(c["path"]) }),
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
): Promise<StorageAdapter> {
  return resolveStorage({ persisted, contentRoot, secrets, factories: STORAGE_FACTORIES });
}
