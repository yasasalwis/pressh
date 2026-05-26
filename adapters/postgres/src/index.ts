import pg from "pg";
import type {
    ColumnKind,
    Cursor,
    Filter,
    Page,
    Result,
    SqlValue,
    StorageAdapter,
    StoredDoc,
    TableSpec,
} from "@pressh/core";
import {
    docToRow,
    journaledTransaction,
    PressError,
    rowToDoc,
    STORAGE_INDEX_FIELDS,
    TABLE_SPECS,
    tableSpecFor,
    toStore,
    typedColumns,
} from "@pressh/core";

/**
 * PostgreSQL StorageAdapter.
 *
 * Host-owned, fixed-shape collections (see TABLE_SPECS) map to NORMALIZED tables
 * — typed columns, UNIQUE/FOREIGN-KEY constraints, indexes — with an `extra`
 * (text JSON) column preserving any unmapped field losslessly. Every other
 * collection lives in the generic `docs(collection, id, jsonb)` table. All
 * values are bound parameters ($1, $2, …); field names are charset-validated
 * and only the (validated) JSON key is inlined into a `->>` path so the
 * expression index is used.
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

// Uniform storage scheme (see @pressh/core typed-mapper): bool→smallint(0/1),
// json→text, integer→bigint, text→text.
const pgType = (kind: ColumnKind): string =>
    kind === "boolean" ? "smallint" : kind === "integer" ? "bigint" : "text";

function createTypedTableSql(spec: TableSpec): string {
    const cols = spec.columns.map(
        (c) => `"${c.field}" ${pgType(c.kind)}${c.notNull ? " NOT NULL" : ""}${c.unique ? " UNIQUE" : ""}`,
    );
    const fks = (spec.foreignKeys ?? []).map(
        (fk) =>
            `FOREIGN KEY ("${fk.column}") REFERENCES "${fk.refTable}"("${fk.refColumn}")` +
            (fk.onDelete === "cascade" ? " ON DELETE CASCADE" : fk.onDelete === "restrict" ? " ON DELETE RESTRICT" : ""),
    );
    const parts = ["id text PRIMARY KEY", ...cols, "extra text NOT NULL DEFAULT '{}'", ...fks];
    return `CREATE TABLE IF NOT EXISTS "${spec.table}"
            (
                ${parts.join(", ")}
            )`;
}

class PostgresStorageAdapter implements StorageAdapter {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async get<T extends StoredDoc = StoredDoc>(collection: string, id: string): Promise<Result<T | null>> {
    try {
        const spec = tableSpecFor(collection);
        if (spec) {
            const res = await this.#pool.query(`SELECT * FROM "${spec.table}" WHERE id = $1`, [id]);
            return ok(res.rows[0] ? rowToDoc<T>(spec, res.rows[0] as Record<string, unknown>) : null);
        }
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
        const spec = tableSpecFor(collection);
        if (spec) {
            const row = docToRow(spec, doc);
            const cols = typedColumns(spec);
            const colSql = cols.map((c) => `"${c}"`).join(", ");
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
            const updates = cols.filter((c) => c !== "id").map((c) => `"${c}"=excluded."${c}"`).join(", ");
            await this.#pool.query(
                `INSERT INTO "${spec.table}" (${colSql}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
                cols.map((c) => row[c] as SqlValue),
            );
            return ok(undefined);
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
        const spec = tableSpecFor(collection);
        if (spec) {
            await this.#pool.query(`DELETE FROM "${spec.table}" WHERE id = $1`, [id]);
            return ok(undefined);
        }
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
        const limit = Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
        const after = page.after ?? null;
        const spec = tableSpecFor(collection);
        if (spec) return ok(await this.#queryTyped<T>(spec, filter, after, limit));
        return ok(await this.#queryDocs<T>(collection, filter, after, limit));
    } catch (e) {
        return fail(e);
    }
  }

  async listCollections(): Promise<Result<string[]>> {
    try {
        const set = new Set<string>();
        for (const spec of TABLE_SPECS) {
            const r = await this.#pool.query(`SELECT 1 FROM "${spec.table}" LIMIT 1`);
            if (r.rows.length) set.add(spec.collection);
        }
      const res = await this.#pool.query<{ collection: string }>(
        `SELECT DISTINCT collection FROM docs ORDER BY collection`,
      );
        for (const r of res.rows) set.add(r.collection);
        return ok([...set].sort());
    } catch (e) {
      return fail(e);
    }
  }

    async #queryTyped<T extends StoredDoc>(
        spec: TableSpec,
        filter: Filter,
        after: string | null,
        limit: number,
    ): Promise<Page<T>> {
        const colByField = new Map(spec.columns.map((c) => [c.field, c]));
        const clauses: string[] = [];
        const params: SqlValue[] = [];
        for (const [field, value] of Object.entries(filter.where ?? {})) {
            if (!SAFE_FIELD.test(field)) throw new PressError("validation", `Invalid filter field: ${field}`);
            if (field === "id") {
                params.push(String(value));
                clauses.push(`id = $${params.length}`);
            } else {
                const col = colByField.get(field);
                if (col) {
                    params.push(toStore(col.kind, value));
                    clauses.push(`"${field}" = $${params.length}`);
                } else {
                    params.push(String(value));
                    clauses.push(`(extra::jsonb->>'${field}') = $${params.length}`);
                }
            }
        }
        if (after !== null) {
            params.push(after);
            clauses.push(`id > $${params.length}`);
        }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        params.push(limit + 1);
        const res = await this.#pool.query(
            `SELECT * FROM "${spec.table}" ${where} ORDER BY id ASC LIMIT $${params.length}`,
            params,
        );
        const hasMore = res.rows.length > limit;
        const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
        const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
        return {
            items: rows.map((r) => rowToDoc<T>(spec, r as Record<string, unknown>)),
            nextCursor: hasMore && last ? String(last["id"]) : null,
        };
    }

  async transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<Result<T>> {
      return journaledTransaction(this, fn);
  }

    async #queryDocs<T extends StoredDoc>(
        collection: string,
        filter: Filter,
        after: string | null,
        limit: number,
    ): Promise<Page<T>> {
        const clauses: string[] = [`collection = $1`];
        const params: (string | number)[] = [collection];
        for (const [field, value] of Object.entries(filter.where ?? {})) {
            if (!SAFE_FIELD.test(field)) throw new PressError("validation", `Invalid filter field: ${field}`);
            params.push(String(value));
            clauses.push(`doc->>'${field}' = $${params.length}`);
        }
        if (after !== null) {
            params.push(after);
            clauses.push(`id > $${params.length}`);
        }
        params.push(limit + 1);
        const res = await this.#pool.query<{ id: string; doc: T }>(
            `SELECT id, doc FROM docs WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT $${params.length}`,
            params,
        );
        const hasMore = res.rows.length > limit;
        const rows = hasMore ? res.rows.slice(0, limit) : res.rows;
        const last = rows[rows.length - 1];
        return {items: rows.map((r) => r.doc), nextCursor: hasMore && last ? last.id : null};
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
    for (const field of STORAGE_INDEX_FIELDS) {
        await pool.query(
            `CREATE INDEX IF NOT EXISTS idx_docs_${field} ON docs (collection, (doc->>'${field}'), id)`,
        );
    }
    // Normalized tables for host-owned collections (parents before children for FKs).
    for (const spec of TABLE_SPECS) {
        await pool.query(createTypedTableSql(spec));
        for (const field of spec.indexes ?? []) {
            await pool.query(`CREATE INDEX IF NOT EXISTS "idx_${spec.table}_${field}" ON "${spec.table}" ("${field}")`);
        }
    }
  return new PostgresStorageAdapter(pool);
}
