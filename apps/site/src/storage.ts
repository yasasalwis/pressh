import type {PersistedStorageConfig, SecretsBackend, StorageAdapter, StorageFactory} from "@pressh/core";
import {resolveStorage, resolveStoragePath} from "@pressh/core";
import {createSqliteStorage} from "@pressh/adapter-sqlite";
import {createPostgresStorage} from "@pressh/adapter-postgres";
import {createMysqlStorage} from "@pressh/adapter-mysql";
import {createMongoStorage} from "@pressh/adapter-mongo";

/**
 * Backend → adapter factory map for the public Site process. Mirrors the
 * Studio's map (each process owns its own wiring across the ADR-002 trust
 * boundary). The Site reads `storage.json` at boot so a Database-Manager cutover
 * applies after its restart, the same as the Studio. The sqlite `path` is
 * resolved against `baseDir` (the data directory) so both processes open the
 * exact same file regardless of their working directory.
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
