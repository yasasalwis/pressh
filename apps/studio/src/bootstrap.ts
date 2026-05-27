import {dirname, join} from "node:path";
import type {SecretsBackend, StorageAdapter} from "@pressh/core";
import {loadStorageConfig, openSecretsVault} from "@pressh/core";
import {buildStorage} from "./storage.js";

/** True when a usable master secret is configured (for the production gate). */
export function hasMasterSecret(raw: string | undefined): boolean {
    return Boolean(raw && raw.trim() !== "");
}

export interface OpenStorageOptions {
    contentRoot: string;
    storageConfigPath?: string;
    secretsPath?: string;
    /**
     * Raw `PRESSH_MASTER_KEY` value (a 32-byte hex/base64 key OR a passphrase).
     * Derivation + the per-install KDF salt are handled by `openSecretsVault`.
     */
    masterSecret?: string;
}

export interface OpenedStorage {
    storage: StorageAdapter;
    secrets: SecretsBackend | undefined;
    dataDir: string;
    vaultPath: string;
    storageConfigPath: string;
}

/**
 * Opens the storage backend selected by `storage.json` — a database
 * (sqlite/postgres/mysql/mongo) or the filesystem default. The vault is opened
 * first because DB backends resolve their connection string from it.
 *
 * This is the SINGLE place every Studio entrypoint (the server AND the seed/
 * admin CLIs) opens storage, so when an operator switches to a database ALL
 * persisted data — content, users, sessions, orders, the lot — lands in that
 * database. Nothing silently keeps writing to the filesystem.
 */
export async function openConfiguredStorage(opts: OpenStorageOptions): Promise<OpenedStorage> {
    const vaultPath = opts.secretsPath ?? join(opts.contentRoot, "..", "vault.json");
    const secrets = (await openSecretsVault({path: vaultPath, secret: opts.masterSecret})) ?? undefined;
    const storageConfigPath = opts.storageConfigPath ?? join(opts.contentRoot, "..", "storage.json");
    const dataDir = dirname(storageConfigPath);
    const persisted = await loadStorageConfig(storageConfigPath);
    const storage = await buildStorage(persisted, opts.contentRoot, secrets, dataDir);
    return {storage, secrets, dataDir, vaultPath, storageConfigPath};
}
