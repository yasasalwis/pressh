import { mkdirSync } from "node:fs";
import {appendFile, readFile, rename, writeFile} from "node:fs/promises";
import { dirname } from "node:path";
import {createHash, createHmac, randomUUID, timingSafeEqual} from "node:crypto";
import { PressError } from "./errors.js";
import { redactDeep, SENSITIVE_KEYS } from "./logger.js";

/**
 * Append-only, hash-chained audit log (ADR-010). Every mutation, capability
 * use, login, and data access appends an entry whose `hash` chains the previous
 * entry's hash, so any after-the-fact edit is detectable via `verifyChain`.
 * `detail` is redacted with the same rules as the logger (baseline #6/#8).
 *
 * The hash chain alone only proves *internal* consistency — an attacker who can
 * write the log file could truncate the tail, or recompute a fresh valid chain
 * from genesis after editing entries, and `verifyChain` would still pass. To
 * close that, when a seal secret is configured the log maintains a separate,
 * HMAC-sealed anchor (`<path>.seal`) recording the entry count and head hash.
 * Forging it requires the key (which lives in the host environment, not the log
 * directory), so truncation and full re-forge are both detected. (Deleting BOTH
 * files looks like a fresh install — true defense against total erasure needs
 * off-host log shipping, noted in RUNBOOK.)
 */
const GENESIS = "";
const SEAL_LABEL = "pressh/audit-seal/v1";

interface AuditSeal {
    count: number;
    headHash: string;
    mac: string;
}

function deriveSealKey(secret: string): Buffer {
    return createHmac("sha256", secret).update(SEAL_LABEL).digest();
}

function sealMac(key: Buffer, count: number, headHash: string): string {
    return createHmac("sha256", key).update(`${count}.${headHash}`).digest("hex");
}

function macEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface AuditEntryInput {
  action: string;
  actorId: string | null;
  detail?: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actorId: string | null;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface AuditQuery {
  action?: string;
  actorId?: string;
  limit?: number;
}

export interface AuditLog {
  append(input: AuditEntryInput): Promise<AuditEntry>;
  verifyChain(): Promise<boolean>;
  query(filter?: AuditQuery): Promise<AuditEntry[]>;
}

/** Deterministic serialization (sorted keys) so hashes are reproducible. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

function computeHash(entry: Omit<AuditEntry, "hash">): string {
  return createHash("sha256").update(stableStringify(entry)).digest("hex");
}

function parseLines(raw: string): AuditEntry[] {
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AuditEntry);
}

class FileAuditLog implements AuditLog {
  readonly #path: string;
    readonly #sealPath: string;
    readonly #sealKey: Buffer | null;
  readonly #sensitive: ReadonlySet<string>;
  #lastHash: string;
    #count: number;
  #queue: Promise<unknown> = Promise.resolve();

    constructor(
        path: string,
        sensitive: ReadonlySet<string>,
        lastHash: string,
        count: number,
        sealKey: Buffer | null,
    ) {
    this.#path = path;
        this.#sealPath = `${path}.seal`;
        this.#sealKey = sealKey;
    this.#sensitive = sensitive;
    this.#lastHash = lastHash;
        this.#count = count;
    }

    async #writeSeal(): Promise<void> {
        if (!this.#sealKey) return;
        const seal: AuditSeal = {
            count: this.#count,
            headHash: this.#lastHash,
            mac: sealMac(this.#sealKey, this.#count, this.#lastHash),
        };
        // Atomic publish so a crash mid-write can't leave a torn seal.
        const tmp = `${this.#sealPath}.${randomUUID().slice(0, 8)}.tmp`;
        await writeFile(tmp, JSON.stringify(seal), "utf8");
        await rename(tmp, this.#sealPath);
    }

    async #readSeal(): Promise<AuditSeal | null> {
        try {
            return JSON.parse(await readFile(this.#sealPath, "utf8")) as AuditSeal;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw new PressError("internal", "Failed to read audit seal");
        }
    }

    /**
     * First-use sealing: write a seal at the current head ONLY if none exists. An
     * existing seal is never overwritten here, so a mismatched/deleted seal stays
     * detectable rather than being silently "healed".
     */
    async ensureSeal(): Promise<void> {
        if (!this.#sealKey) return;
        if ((await this.#readSeal()) === null) await this.#writeSeal();
  }

  async #appendLocked(input: AuditEntryInput): Promise<AuditEntry> {
    const base: Omit<AuditEntry, "hash"> = {
      id: randomUUID(),
      at: new Date().toISOString(),
      action: input.action,
      actorId: input.actorId,
      detail: redactDeep(input.detail ?? {}, this.#sensitive) as Record<string, unknown>,
      prevHash: this.#lastHash,
    };
    const entry: AuditEntry = { ...base, hash: computeHash(base) };
    await appendFile(this.#path, `${JSON.stringify(entry)}\n`, "utf8");
    this.#lastHash = entry.hash;
      this.#count += 1;
      await this.#writeSeal();
    return entry;
  }

  append(input: AuditEntryInput): Promise<AuditEntry> {
    const result = this.#queue.then(() => this.#appendLocked(input));
    // Keep the chain alive even if one append rejects, but surface the error
    // to the caller via `result`.
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #readAll(): Promise<AuditEntry[]> {
    try {
      return parseLines(await readFile(this.#path, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new PressError("internal", "Failed to read audit log");
    }
  }

  async verifyChain(): Promise<boolean> {
    const entries = await this.#readAll();
    let prev = GENESIS;
    for (const entry of entries) {
      if (entry.prevHash !== prev) return false;
      const { hash, ...rest } = entry;
      if (computeHash(rest) !== hash) return false;
      prev = entry.hash;
    }
      const head = entries.length ? entries[entries.length - 1]!.hash : GENESIS;

      // Without a seal key the anchor is disabled — internal consistency only.
      if (!this.#sealKey) return true;

      const seal = await this.#readSeal();
      if (!seal) {
          // The anchor is configured but the seal is gone. Only legitimate when
          // there are no entries at all; otherwise the seal was deleted (tampering).
          return entries.length === 0;
      }
      // The MAC must verify (an attacker can't forge it without the key), and the
      // sealed count + head must match the file — catching truncation (count) and
      // a from-genesis re-forge (head).
      if (!macEqual(seal.mac, sealMac(this.#sealKey, seal.count, seal.headHash))) return false;
      if (seal.count !== entries.length) return false;
      if (seal.headHash !== head) return false;
    return true;
  }

  async query(filter: AuditQuery = {}): Promise<AuditEntry[]> {
    let entries = await this.#readAll();
    if (filter.action !== undefined) entries = entries.filter((e) => e.action === filter.action);
    if (filter.actorId !== undefined) {
      entries = entries.filter((e) => e.actorId === filter.actorId);
    }
    if (filter.limit !== undefined) entries = entries.slice(-filter.limit);
    return entries;
  }
}

export async function createFileAuditLog(opts: {
  path: string;
  sensitiveKeys?: ReadonlySet<string>;
    /**
     * Secret (typically `PRESSH_MASTER_KEY`) used to derive the HMAC key that
     * seals the tamper-evidence anchor. When omitted, the anchor is disabled and
     * `verifyChain` checks internal consistency only (backward compatible).
     */
    sealSecret?: string;
}): Promise<AuditLog> {
  mkdirSync(dirname(opts.path), { recursive: true });

  let lastHash = GENESIS;
    let count = 0;
  try {
    const entries = parseLines(await readFile(opts.path, "utf8"));
      count = entries.length;
    const last = entries[entries.length - 1];
    if (last) lastHash = last.hash;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new PressError("internal", "Failed to read audit log");
    }
  }

    const sealKey = opts.sealSecret ? deriveSealKey(opts.sealSecret) : null;
    const log = new FileAuditLog(opts.path, opts.sensitiveKeys ?? SENSITIVE_KEYS, lastHash, count, sealKey);

    // First-use sealing: if the anchor is enabled but no seal exists yet (a fresh
    // install or a log predating this feature), establish one at the current head
    // — trusting the on-disk state at this trust-establishment moment. Thereafter
    // the seal is maintained on every append and a missing/mismatched seal is a
    // tamper signal.
    await log.ensureSeal();

    return log;
}
