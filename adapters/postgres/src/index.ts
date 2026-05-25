import pg from "pg";
import { PressError } from "@pressh/core";
import type { Cursor, Filter, Page, Result, StorageAdapter, StoredDoc } from "@pressh/core";

/**
 * PostgreSQL StorageAdapter. Documents are stored in a single `docs` table with
 * a `jsonb` payload. All values are bound parameters ($1, $2, …) — never
 * string-built SQL. JSON filter keys are validated against a strict charset
 * before being used in a `->>` path.
 */
const SAFE_FIELD = /^[A-Za-z0-9_]+$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export interface PostgresStorageOptions {
  connectionString: string;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function fail(e: unknown): Result<never> {
  // Never surface the raw driver error (it can include the connection string /
  // host) to callers; wrap unknown errors in a generic message.
  return { ok: false, error: e instanceof PressError ? e : new PressError("internal", "Storage backend error") };
}

class PostgresStorageAdapter implements StorageAdapter {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async get<T extends StoredDoc = StoredDoc>(collection: string, id: string): Promise<Result<T | null>> {
    try {
      const res = await this.#pool.query<{ doc: T }>(
        `SELECT doc FROM docs WHERE collection = $1 AND id = $2`,
        [collection, id],
      );
      return ok(res.rows[0]?.doc ?? null);
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
        `INSERT INTO docs (collection, id, doc) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (collection, id) DO UPDATE SET doc = excluded.doc`,
        [collection, doc.id, JSON.stringify(doc)],
      );
      return ok(undefined);
    } catch (e) {
      return fail(e);
    }
  }

  async delete(collection: string, id: string): Promise<Result<void>> {
    try {
      await this.#pool.query(`DELETE FROM docs WHERE collection = $1 AND id = $2`, [collection, id]);
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
      const clauses: string[] = [`collection = $1`];
      const params: (string | number)[] = [collection];
      for (const [field, value] of Object.entries(filter.where ?? {})) {
        if (!SAFE_FIELD.test(field)) throw new PressError("validation", `Invalid filter field: ${field}`);
        params.push(String(value));
        clauses.push(`doc->>'${field}' = $${params.length}`);
      }
      const after = page.after ?? null;
      if (after !== null) {
        params.push(after);
        clauses.push(`id > $${params.length}`);
      }
      const limit = Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      params.push(limit + 1);
      const sql = `SELECT id, doc FROM docs WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT $${params.length}`;
      const res = await this.#pool.query<{ id: string; doc: T }>(sql, params);

      const hasMore = res.rows.length > limit;
      const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
      const last = rows[rows.length - 1];
      return ok({ items: rows.map((r) => r.doc), nextCursor: hasMore && last ? last.id : null });
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
      const res = await this.#pool.query<{ collection: string }>(
        `SELECT DISTINCT collection FROM docs ORDER BY collection`,
      );
      return ok(res.rows.map((r) => r.collection));
    } catch (e) {
      return fail(e);
    }
  }

  async rebuildIndex(): Promise<Result<void>> {
    return ok(undefined); // Postgres is the canonical store.
  }

  close(): void {
    void this.#pool.end();
  }
}

export async function createPostgresStorage(opts: PostgresStorageOptions): Promise<StorageAdapter> {
  const pool = new pg.Pool({ connectionString: opts.connectionString });
  await pool.query(
    `CREATE TABLE IF NOT EXISTS docs (
       collection text NOT NULL,
       id         text NOT NULL,
       doc        jsonb NOT NULL,
       PRIMARY KEY (collection, id)
     )`,
  );
  return new PostgresStorageAdapter(pool);
}
