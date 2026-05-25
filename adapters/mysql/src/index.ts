import mysql from "mysql2/promise";
import { PressError } from "@pressh/core";
import type { Cursor, Filter, Page, Result, StorageAdapter, StoredDoc } from "@pressh/core";

/**
 * MySQL / MariaDB StorageAdapter. Documents are stored in a single `docs` table
 * with a native `JSON` payload. All values are bound parameters (`?`) — never
 * string-built SQL — and JSON filter keys are validated against a strict charset
 * before being used in a `JSON_EXTRACT` path.
 *
 * The `id` column uses a binary collation so the cursor's `id > ?` / `ORDER BY
 * id` comparisons are bytewise and deterministic, matching the FS/SQLite/Postgres
 * adapters (default MySQL collations are case-insensitive, which would make
 * pagination cursors unstable).
 */
const SAFE_FIELD = /^[A-Za-z0-9_]+$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export interface MysqlStorageOptions {
  /** A MySQL connection URI, e.g. `mysql://user:pass@host:3306/pressh`. */
  uri: string;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function fail(e: unknown): Result<never> {
  return { ok: false, error: e instanceof PressError ? e : new PressError("internal", String(e)) };
}

/** mysql2 parses JSON columns into objects; older paths may return a string. */
function parseDoc<T extends StoredDoc>(raw: unknown): T {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
}

class MysqlStorageAdapter implements StorageAdapter {
  readonly #pool: mysql.Pool;

  constructor(pool: mysql.Pool) {
    this.#pool = pool;
  }

  async get<T extends StoredDoc = StoredDoc>(collection: string, id: string): Promise<Result<T | null>> {
    try {
      const [rows] = await this.#pool.query(
        `SELECT doc FROM docs WHERE collection = ? AND id = ?`,
        [collection, id],
      );
      const row = (rows as { doc: unknown }[])[0];
      return ok(row ? parseDoc<T>(row.doc) : null);
    } catch (e) {
      return fail(e);
    }
  }

  async put(collection: string, doc: StoredDoc): Promise<Result<void>> {
    try {
      if (typeof doc.id !== "string" || doc.id.length === 0) {
        throw new PressError("validation", "Document must have a non-empty string id");
      }
      await this.#pool.query(
        `INSERT INTO docs (collection, id, doc) VALUES (?, ?, CAST(? AS JSON))
         ON DUPLICATE KEY UPDATE doc = VALUES(doc)`,
        [collection, doc.id, JSON.stringify(doc)],
      );
      return ok(undefined);
    } catch (e) {
      return fail(e);
    }
  }

  async delete(collection: string, id: string): Promise<Result<void>> {
    try {
      await this.#pool.query(`DELETE FROM docs WHERE collection = ? AND id = ?`, [collection, id]);
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
        clauses.push(`JSON_UNQUOTE(JSON_EXTRACT(doc, ?)) = ?`);
        params.push(`$.${field}`, String(value));
      }
      const after = page.after ?? null;
      if (after !== null) {
        clauses.push(`id > ?`);
        params.push(after);
      }
      const limit = Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const sql = `SELECT id, doc FROM docs WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ?`;
      const [rows] = await this.#pool.query(sql, [...params, limit + 1]);
      const list = rows as { id: string; doc: unknown }[];

      const hasMore = list.length > limit;
      const pageRows = hasMore ? list.slice(0, limit) : list;
      const last = pageRows[pageRows.length - 1];
      return ok({
        items: pageRows.map((r) => parseDoc<T>(r.doc)),
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
      const [rows] = await this.#pool.query(`SELECT DISTINCT collection FROM docs ORDER BY collection`);
      return ok((rows as { collection: string }[]).map((r) => r.collection));
    } catch (e) {
      return fail(e);
    }
  }

  async rebuildIndex(): Promise<Result<void>> {
    return ok(undefined); // MySQL is the canonical store.
  }

  close(): void {
    void this.#pool.end();
  }
}

export async function createMysqlStorage(opts: MysqlStorageOptions): Promise<StorageAdapter> {
  const pool = mysql.createPool(opts.uri);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS docs (
       collection VARCHAR(191) NOT NULL,
       id         VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
       doc        JSON NOT NULL,
       PRIMARY KEY (collection, id)
     ) DEFAULT CHARACTER SET utf8mb4`,
  );
  return new MysqlStorageAdapter(pool);
}
