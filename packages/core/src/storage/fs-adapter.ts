import { mkdirSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { PressError } from "../errors.js";
import { err, ok } from "../result.js";
import type { Result } from "../result.js";
import { runMigrations } from "./migrations.js";
import type { Cursor, Filter, Page, StorageAdapter, StoredDoc } from "./types.js";

// Reject path traversal and unsafe characters in collection/id segments.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
// Filter field names are interpolated into a JSON path, so constrain them hard.
const SAFE_FIELD = /^[A-Za-z0-9_]+$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

type DB = Database.Database;

interface DocRow {
  id: string;
  doc: string;
}

export interface FileSystemStorageOptions {
  root: string;
  indexPath?: string;
}

function assertSegment(value: string, kind: "collection" | "id"): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("..") ||
    !SAFE_SEGMENT.test(value)
  ) {
    throw new PressError("validation", `Invalid ${kind}: ${value}`, { [kind]: value });
  }
}

function toPressError(e: unknown): PressError {
  if (e instanceof PressError) return e;
  return new PressError("internal", e instanceof Error ? e.message : "Storage error");
}

class FileSystemStorageAdapter implements StorageAdapter {
  readonly #root: string;
  readonly #db: DB;

  constructor(opts: FileSystemStorageOptions) {
    this.#root = opts.root;
    const indexPath = opts.indexPath ?? join(opts.root, ".index.sqlite");
    mkdirSync(opts.root, { recursive: true });
    mkdirSync(dirname(indexPath), { recursive: true });
    this.#db = new Database(indexPath);
    // The two-process trust split shares this index file. busy_timeout makes
    // writers wait for the WAL lock instead of failing with SQLITE_BUSY. The
    // journal_mode switch needs a brief exclusive lock, so only do it when not
    // already in WAL, and tolerate a concurrent switch by another process.
    this.#db.pragma("busy_timeout = 5000");
    try {
      if (this.#db.pragma("journal_mode", { simple: true }) !== "wal") {
        this.#db.pragma("journal_mode = WAL");
      }
    } catch {
      // Another process is enabling WAL on the shared index right now — fine.
    }
    runMigrations(this.#db);
  }

  #file(collection: string, id: string): string {
    return join(this.#root, collection, `${id}.json`);
  }

  async get<T extends StoredDoc = StoredDoc>(
    collection: string,
    id: string,
  ): Promise<Result<T | null>> {
    try {
      assertSegment(collection, "collection");
      assertSegment(id, "id");
      const row = this.#db
        .prepare(`SELECT doc FROM docs WHERE collection = ? AND id = ?`)
        .get(collection, id) as { doc: string } | undefined;
      if (!row) return ok(null);
      return ok(JSON.parse(row.doc) as T);
    } catch (e) {
      return err(toPressError(e));
    }
  }

  async put(collection: string, doc: StoredDoc): Promise<Result<void>> {
    try {
      assertSegment(collection, "collection");
      assertSegment(doc.id, "id");
      const serialized = JSON.stringify(doc);
      await mkdir(join(this.#root, collection), { recursive: true });
      await writeFile(this.#file(collection, doc.id), serialized, "utf8");
      this.#db
        .prepare(`INSERT OR REPLACE INTO docs (collection, id, doc) VALUES (?, ?, ?)`)
        .run(collection, doc.id, serialized);
      return ok(undefined);
    } catch (e) {
      return err(toPressError(e));
    }
  }

  async delete(collection: string, id: string): Promise<Result<void>> {
    try {
      assertSegment(collection, "collection");
      assertSegment(id, "id");
      await rm(this.#file(collection, id), { force: true });
      this.#db.prepare(`DELETE FROM docs WHERE collection = ? AND id = ?`).run(collection, id);
      return ok(undefined);
    } catch (e) {
      return err(toPressError(e));
    }
  }

  async query<T extends StoredDoc = StoredDoc>(
    collection: string,
    filter: Filter = {},
    page: Cursor = {},
  ): Promise<Result<Page<T>>> {
    try {
      assertSegment(collection, "collection");
      const clauses: string[] = [`collection = ?`];
      const params: (string | number)[] = [collection];

      for (const [field, value] of Object.entries(filter.where ?? {})) {
        if (!SAFE_FIELD.test(field)) {
          throw new PressError("validation", `Invalid filter field: ${field}`);
        }
        clauses.push(`json_extract(doc, ?) = ?`);
        params.push(`$.${field}`, typeof value === "boolean" ? (value ? 1 : 0) : value);
      }

      const after = page.after ?? null;
      if (after !== null) {
        clauses.push(`id > ?`);
        params.push(after);
      }

      const limit = Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const sql = `SELECT id, doc FROM docs WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ?`;
      const rows = this.#db.prepare(sql).all(...params, limit + 1) as DocRow[];

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const items = pageRows.map((row) => JSON.parse(row.doc) as T);
      const last = pageRows[pageRows.length - 1];
      const nextCursor = hasMore && last ? last.id : null;
      return ok({ items, nextCursor });
    } catch (e) {
      return err(toPressError(e));
    }
  }

  async transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<Result<T>> {
    // The filesystem is the canonical store and the SQLite index is always
    // rebuildable from it, so this is best-effort batching rather than
    // cross-store ACID. True transactional guarantees arrive with the database
    // adapters in Phase 16.
    try {
      return ok(await fn(this));
    } catch (e) {
      return err(toPressError(e));
    }
  }

  async rebuildIndex(): Promise<Result<void>> {
    try {
      const docs: { collection: string; id: string; doc: string }[] = [];
      let collections: string[] = [];
      try {
        const entries = await readdir(this.#root, { withFileTypes: true });
        collections = entries
          .filter((entry) => entry.isDirectory() && SAFE_SEGMENT.test(entry.name))
          .map((entry) => entry.name)
          .sort();
      } catch {
        collections = [];
      }

      for (const collection of collections) {
        const dir = join(this.#root, collection);
        const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
        for (const file of files) {
          const raw = await readFile(join(dir, file), "utf8");
          const parsed = JSON.parse(raw) as StoredDoc;
          if (typeof parsed.id === "string") {
            docs.push({ collection, id: parsed.id, doc: raw });
          }
        }
      }

      const rebuild = this.#db.transaction(() => {
        this.#db.prepare(`DELETE FROM docs`).run();
        const insert = this.#db.prepare(
          `INSERT OR REPLACE INTO docs (collection, id, doc) VALUES (?, ?, ?)`,
        );
        for (const entry of docs) insert.run(entry.collection, entry.id, entry.doc);
      });
      rebuild();
      return ok(undefined);
    } catch (e) {
      return err(toPressError(e));
    }
  }

  async listCollections(): Promise<Result<string[]>> {
    try {
      const rows = this.#db
        .prepare(`SELECT DISTINCT collection FROM docs ORDER BY collection`)
        .all() as { collection: string }[];
      return ok(rows.map((r) => r.collection));
    } catch (e) {
      return err(toPressError(e));
    }
  }

  close(): void {
    this.#db.close();
  }
}

export function createFileSystemStorage(opts: FileSystemStorageOptions): StorageAdapter {
  return new FileSystemStorageAdapter(opts);
}
