import {dirname, join} from "node:path";
import {
    createFileSecretsBackend,
    deriveMasterKey,
    loadStorageConfig,
    MASTER_KEY_BYTES,
} from "@pressh/core";
import type {SecretsBackend, StorageAdapter} from "@pressh/core";
import {buildStorage} from "./storage.js";

const MASTER_KEY_SALT = Buffer.from("pressh.secrets.v1");

/**
 * Parse the operator master key. A 32-byte key encoded as hex (64 chars) or
 * base64 is used directly; anything else is treated as a passphrase and
 * stretched with scrypt. Returns null for an empty/absent value.
 */
export function parseMasterKey(raw: string | undefined): Buffer | null {
    if (!raw) return null;
    const value = raw.trim();
    if (value === "") return null;
    if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
    const b64 = Buffer.from(value, "base64");
    if (b64.length === MASTER_KEY_BYTES) return b64;
    return deriveMasterKey(value, MASTER_KEY_SALT);
}

export interface OpenStorageOptions {
    contentRoot: string;
    storageConfigPath?: string;
    secretsPath?: string;
    masterKey?: Buffer;
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
    const secrets = opts.masterKey
        ? await createFileSecretsBackend({path: vaultPath, key: opts.masterKey})
        : undefined;
    const storageConfigPath = opts.storageConfigPath ?? join(opts.contentRoot, "..", "storage.json");
    const dataDir = dirname(storageConfigPath);
    const persisted = await loadStorageConfig(storageConfigPath);
    const storage = await buildStorage(persisted, opts.contentRoot, secrets, dataDir);
    return {storage, secrets, dataDir, vaultPath, storageConfigPath};
}
