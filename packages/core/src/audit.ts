import { mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PressError } from "./errors.js";
import { redactDeep, SENSITIVE_KEYS } from "./logger.js";

/**
 * Append-only, hash-chained audit log (ADR-010). Every mutation, capability
 * use, login, and data access appends an entry whose `hash` chains the previous
 * entry's hash, so any after-the-fact edit is detectable via `verifyChain`.
 * `detail` is redacted with the same rules as the logger (baseline #6/#8).
 */
const GENESIS = "";

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
  readonly #sensitive: ReadonlySet<string>;
  #lastHash: string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string, sensitive: ReadonlySet<string>, lastHash: string) {
    this.#path = path;
    this.#sensitive = sensitive;
    this.#lastHash = lastHash;
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
}): Promise<AuditLog> {
  mkdirSync(dirname(opts.path), { recursive: true });

  let lastHash = GENESIS;
  try {
    const entries = parseLines(await readFile(opts.path, "utf8"));
    const last = entries[entries.length - 1];
    if (last) lastHash = last.hash;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new PressError("internal", "Failed to read audit log");
    }
  }

  return new FileAuditLog(opts.path, opts.sensitiveKeys ?? SENSITIVE_KEYS, lastHash);
}
