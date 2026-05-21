import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { PressError } from "./errors.js";

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

interface SecretRecord {
  iv: string;
  ct: string;
  tag: string;
  scope: string | null;
}

interface VaultFile {
  version: number;
  secrets: Record<string, SecretRecord>;
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
    await writeFile(this.#path, JSON.stringify(this.#vault, null, 2), "utf8");
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

  return new FileSecretsBackend(opts.path, opts.key, vault);
}

/** Derive a 32-byte key from an operator passphrase + salt (scrypt). */
export function deriveMasterKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, MASTER_KEY_BYTES);
}
