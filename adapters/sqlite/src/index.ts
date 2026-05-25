import {mkdirSync} from "node:fs";
import {dirname} from "node:path";
import Database from "better-sqlite3";
import type {Cursor, Filter, Page, Result, StorageAdapter, StoredDoc} from "@pressh/core";
import {PressError} from "@pressh/core";

/**
 * SQLite StorageAdapter — SQLite is the canonical store (not just an index).
 * Documents live in a single `docs(collection, id, doc)` table; filters use
 * parameterized `json_extract` (never string-built SQL), and pagination is a
 * stable id-ordered cursor — matching the FS adapter's behavior exactly.
 */
const SAFE_FIELD = /^[A-Za-z0-9_]+$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

type DB = Database.Database;
interface DocRow {
  id: string;
  doc: string;
}

export interface SqliteStorageOptions {
  /** File path, or ":memory:" for an ephemeral database. */
  path: string;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function fail(e: unknown): Result<never> {
  return { ok: false, error: e instanceof PressError ? e : new PressError("internal", String(e)) };
}

class SqliteStorageAdapter implements StorageAdapter {
  readonly #db: DB;

  constructor(opts: SqliteStorageOptions) {
      // Create the containing directory so a nested path (e.g. "db/pressh.sqlite")
      // works; better-sqlite3 will not create missing parent directories itself.
      if (opts.path !== ":memory:") {
          mkdirSync(dirname(opts.path), {recursive: true});
      }
    this.#db = new Database(opts.path);
    this.#db.pragma("busy_timeout = 5000");
    try {
      if (this.#db.pragma("journal_mode", { simple: true }) !== "wal") {
        this.#db.pragma("journal_mode = WAL");
      }
    } catch {
      // Another process is enabling WAL on a shared file — fine.
    }
    this.#db.exec(
      `CREATE TABLE IF NOT EXISTS docs (
         collection TEXT NOT NULL,
         id         TEXT NOT NULL,
         doc        TEXT NOT NULL,
         PRIMARY KEY (collection, id)
       );`,
    );
  }

  async get<T extends StoredDoc = StoredDoc>(collection: string, id: string): Promise<Result<T | null>> {
    try {
      const row = this.#db
        .prepare(`SELECT doc FROM docs WHERE collection = ? AND id = ?`)
        .get(collection, id) as { doc: string } | undefined;
      return ok(row ? (JSON.parse(row.doc) as T) : null);
    } catch (e) {
      return fail(e);
    }
  }

  async put(collection: string, doc: StoredDoc): Promise<Result<void>> {
    try {
      if (typeof doc.id !== "string" || doc.id.length === 0) {
        throw new PressError("validation", "Document must have a non-empty string id");
      }
      this.#db
        .prepare(`INSERT OR REPLACE INTO docs (collection, id, doc) VALUES (?, ?, ?)`)
        .run(collection, doc.id, JSON.stringify(doc));
      return ok(undefined);
    } catch (e) {
      return fail(e);
    }
  }

  async delete(collection: string, id: string): Promise<Result<void>> {
    try {
      this.#db.prepare(`DELETE FROM docs WHERE collection = ? AND id = ?`).run(collection, id);
      return ok(undefined);
    } catch (e) {
      return fail(e);
    }
  }

  async query<T extends StoredDoc = StoredDoc>(
    collection: string,
    filter: Filter = {},
    page: Cursor = {},
  ): Promise<Result<Page<T>>> {
    try {
      const clauses: string[] = [`collection = ?`];
      const params: (string | number)[] = [collection];
      for (const [field, value] of Object.entries(filter.where ?? {})) {
        if (!SAFE_FIELD.test(field)) throw new PressError("validation", `Invalid filter field: ${field}`);
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
      const last = pageRows[pageRows.length - 1];
      return ok({
        items: pageRows.map((r) => JSON.parse(r.doc) as T),
        nextCursor: hasMore && last ? last.id : null,
      });
    } catch (e) {
      return fail(e);
    }
  }

  async transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<Result<T>> {
    try {
      return ok(await fn(this));
    } catch (e) {
      return fail(e);
    }
  }

  async listCollections(): Promise<Result<string[]>> {
    try {
      const rows = this.#db
        .prepare(`SELECT DISTINCT collection FROM docs ORDER BY collection`)
        .all() as { collection: string }[];
      return ok(rows.map((r) => r.collection));
    } catch (e) {
      return fail(e);
    }
  }

  async rebuildIndex(): Promise<Result<void>> {
    return ok(undefined); // SQLite is the canonical store; no separate index.
  }

  close(): void {
    this.#db.close();
  }
}

export function createSqliteStorage(opts: SqliteStorageOptions): StorageAdapter {
  return new SqliteStorageAdapter(opts);
}
