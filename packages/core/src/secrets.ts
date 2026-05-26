import {mkdirSync} from "node:fs";
import {readFile, rename, writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {createCipheriv, createDecipheriv, randomBytes, scryptSync} from "node:crypto";
import {PressError} from "./errors.js";

/**
 * Sealed secrets vault (ADR-009). Secrets are encrypted at rest with
 * AES-256-GCM under a 32-byte master key supplied at boot (`PRESSH_MASTER_KEY`)
 * and never written in plaintext. Plugins never read `process.env`; they will
 * request a secret by name through the capability-gated SDK (Phase 8).
 *
 * Fail-closed: a wrong master key (or a tampered vault) makes GCM authentication
 * fail, and the vault throws rather than returning garbage.
 */
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
export const MASTER_KEY_BYTES = 32;

/**
 * Legacy passphrase-KDF salt (v1). It was a single hardcoded constant shared by
 * every install, so a passphrase derived the same key everywhere — precomputable
 * offline. Kept ONLY to re-derive the old key when migrating a pre-existing vault
 * to the per-install salt below; never used to seal new data.
 */
export const LEGACY_MASTER_KEY_SALT = Buffer.from("pressh.secrets.v1");

// Per-install scrypt parameters (v2). The salt is random per install and stored
// (in the clear — salts are not secret) inside the vault next to the ciphertext,
// so it is read before deriving the key. N is raised well above scrypt's default
// (2^14) to slow offline guessing of a weak passphrase.
const KDF_VERSION = 2;
const KDF_N = 1 << 16; // 65536
const KDF_MAXMEM = 192 * 1024 * 1024;
const KDF_SALT_BYTES = 16;

export interface KdfParams {
    v: number;
    /** base64 random salt. */
    salt: string;
    /** scrypt cost parameter N. */
    n: number;
}

interface SecretRecord {
  iv: string;
  ct: string;
  tag: string;
  scope: string | null;
}

interface VaultFile {
  version: number;
    /** Present once the vault uses a per-install KDF salt (absent ⇒ legacy v1). */
    kdf?: KdfParams;
  secrets: Record<string, SecretRecord>;
}

/** Atomically replace the vault file (temp + rename) so kdf and ciphertext never diverge. */
async function persistVault(path: string, vault: VaultFile): Promise<void> {
    const tmp = `${path}.tmp-${randomBytes(6).toString("hex")}`;
    await writeFile(tmp, JSON.stringify(vault, null, 2), "utf8");
    await rename(tmp, path);
}

function newKdfParams(): KdfParams {
    return {v: KDF_VERSION, salt: randomBytes(KDF_SALT_BYTES).toString("base64"), n: KDF_N};
}

/** Stretch a passphrase into a 32-byte key under the given per-install KDF params. */
function deriveKey(passphrase: string, params: KdfParams): Buffer {
    return scryptSync(passphrase, Buffer.from(params.salt, "base64"), MASTER_KEY_BYTES, {
        N: params.n,
        r: 8,
        p: 1,
        maxmem: KDF_MAXMEM,
    });
}

/** Read just the (plaintext) KDF params from a vault file, if it exists and has them. */
async function readVaultKdf(path: string): Promise<KdfParams | null> {
    try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as { kdf?: unknown };
        const kdf = parsed.kdf as Partial<KdfParams> | undefined;
        if (kdf && typeof kdf.salt === "string" && typeof kdf.n === "number") {
            return {v: typeof kdf.v === "number" ? kdf.v : KDF_VERSION, salt: kdf.salt, n: kdf.n};
        }
        return null;
    } catch {
        return null;
    }
}

export interface SecretsBackend {
  setSecret(name: string, value: string, scope?: string): Promise<void>;
  getSecret(name: string): Promise<string>;
  hasSecret(name: string): Promise<boolean>;
  deleteSecret(name: string): Promise<void>;
  listNames(): Promise<string[]>;
  /** Re-encrypts every secret under a new 32-byte key. Fail-closed. */
  rotate(newKey: Buffer): Promise<void>;
}

function encrypt(key: Buffer, plaintext: string): Omit<SecretRecord, "scope"> {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(key: Buffer, record: SecretRecord): string {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  try {
    const out = Buffer.concat([
      decipher.update(Buffer.from(record.ct, "base64")),
      decipher.final(),
    ]);
    return out.toString("utf8");
  } catch {
    throw new PressError(
      "unauthorized",
      "Secret decryption failed — wrong master key or tampered vault",
    );
  }
}

class FileSecretsBackend implements SecretsBackend {
  readonly #path: string;
  #key: Buffer;
  #vault: VaultFile;

  constructor(path: string, key: Buffer, vault: VaultFile) {
    this.#path = path;
    this.#key = key;
    this.#vault = vault;
  }

  async #persist(): Promise<void> {
      await persistVault(this.#path, this.#vault);
  }

  async setSecret(name: string, value: string, scope?: string): Promise<void> {
    this.#vault.secrets[name] = { ...encrypt(this.#key, value), scope: scope ?? null };
    await this.#persist();
  }

  async getSecret(name: string): Promise<string> {
    const record = this.#vault.secrets[name];
    if (!record) throw new PressError("not_found", `Secret not found: ${name}`);
    return decrypt(this.#key, record);
  }

  async hasSecret(name: string): Promise<boolean> {
    return Object.hasOwn(this.#vault.secrets, name);
  }

  async deleteSecret(name: string): Promise<void> {
    delete this.#vault.secrets[name];
    await this.#persist();
  }

  async listNames(): Promise<string[]> {
    return Object.keys(this.#vault.secrets);
  }

  async rotate(newKey: Buffer): Promise<void> {
    if (newKey.length !== MASTER_KEY_BYTES) {
      throw new PressError("validation", `Master key must be ${MASTER_KEY_BYTES} bytes`);
    }
    const next: Record<string, SecretRecord> = {};
    for (const [name, record] of Object.entries(this.#vault.secrets)) {
      const plain = decrypt(this.#key, record); // fail-closed if current key is wrong
      next[name] = { ...encrypt(newKey, plain), scope: record.scope };
    }
    this.#vault.secrets = next;
    this.#key = newKey;
    await this.#persist();
  }
}

export async function createFileSecretsBackend(opts: {
  path: string;
  key: Buffer;
    /**
     * When set together with `kdf`, an existing legacy (no-kdf) vault is migrated:
     * every secret is re-encrypted FROM `migrateFrom` TO `key`, then the kdf params
     * are stamped — all in one atomic write, so the stored salt always matches the
     * ciphertext (no lockout window). Omit for a fresh vault or a raw-key vault.
     */
    migrateFrom?: Buffer;
    kdf?: KdfParams;
}): Promise<SecretsBackend> {
  if (opts.key.length !== MASTER_KEY_BYTES) {
    throw new PressError("validation", `Master key must be ${MASTER_KEY_BYTES} bytes`);
  }
  mkdirSync(dirname(opts.path), { recursive: true });

  let vault: VaultFile;
  try {
    const parsed = JSON.parse(await readFile(opts.path, "utf8")) as VaultFile;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.secrets !== "object") {
      throw new PressError("internal", "Vault file is malformed");
    }
    vault = parsed;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      vault = { version: 1, secrets: {} };
    } else if (e instanceof PressError) {
      throw e;
    } else {
      throw new PressError("internal", "Failed to read vault file");
    }
  }

    // Migrate a legacy vault to the per-install salt the first time we open it with
    // kdf params. Re-encrypt existing secrets from the legacy key to the new key;
    // a fail-closed decrypt (wrong legacy key) aborts rather than corrupting data.
    if (opts.kdf && !vault.kdf) {
        if (Object.keys(vault.secrets).length > 0 && opts.migrateFrom) {
            const next: Record<string, SecretRecord> = {};
            for (const [name, record] of Object.entries(vault.secrets)) {
                const plain = decrypt(opts.migrateFrom, record);
                next[name] = {...encrypt(opts.key, plain), scope: record.scope};
            }
            vault.secrets = next;
        }
        vault.kdf = opts.kdf;
        await persistVault(opts.path, vault);
    }

  return new FileSecretsBackend(opts.path, opts.key, vault);
}

/**
 * Resolves the operator master key from the raw `PRESSH_MASTER_KEY` value and
 * opens the vault. A 32-byte key encoded as hex (64 chars) or base64 is used
 * verbatim (no KDF). Anything else is treated as a passphrase and stretched with
 * scrypt under a per-install random salt persisted in the vault; a pre-existing
 * vault sealed with the legacy static salt is transparently re-encrypted under
 * the new key on first open. Returns null for an empty/absent value.
 *
 * This is the single entry point both the Studio and Site processes use, so they
 * derive the same key and agree on the vault's KDF state.
 */
export async function openSecretsVault(opts: {
    path: string;
    secret: string | undefined;
}): Promise<SecretsBackend | null> {
    if (!opts.secret) return null;
    const value = opts.secret.trim();
    if (value === "") return null;

    if (/^[0-9a-fA-F]{64}$/.test(value)) {
        return createFileSecretsBackend({path: opts.path, key: Buffer.from(value, "hex")});
    }
    const b64 = Buffer.from(value, "base64");
    if (b64.length === MASTER_KEY_BYTES) {
        return createFileSecretsBackend({path: opts.path, key: b64});
    }

    // Passphrase path.
    const existing = await readVaultKdf(opts.path);
    if (existing) {
        return createFileSecretsBackend({path: opts.path, key: deriveKey(value, existing)});
    }
    const kdf = newKdfParams();
    const key = deriveKey(value, kdf);
    const legacyKey = deriveMasterKey(value, LEGACY_MASTER_KEY_SALT);
    return createFileSecretsBackend({path: opts.path, key, migrateFrom: legacyKey, kdf});
}

/** Derive a 32-byte key from an operator passphrase + salt (scrypt). */
export function deriveMasterKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, MASTER_KEY_BYTES);
}
