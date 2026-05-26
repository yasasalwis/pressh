import mysql from "mysql2/promise";
import type {
    ColumnSpec,
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

const INDEX_FIELDS = new Set<string>(STORAGE_INDEX_FIELDS);

/**
 * The functional-index expression for a hot field in the `docs` table, used
 * IDENTICALLY in the index definition and the WHERE clause so MySQL's optimizer
 * matches them. CHAR(255) covers every indexed field (emails ≤254, slugs ≤80,
 * UUIDs, hashes). `field` is SAFE_FIELD-validated.
 */
function indexedExpr(field: string): string {
    return `CAST(JSON_UNQUOTE(JSON_EXTRACT(doc, '$.${field}')) AS CHAR(255))`;
}

/**
 * MySQL / MariaDB StorageAdapter.
 *
 * Host-owned, fixed-shape collections (see TABLE_SPECS) map to NORMALIZED tables
 * with typed columns, UNIQUE/FOREIGN-KEY constraints and an `extra` (TEXT JSON)
 * column for unmapped fields. Every other collection lives in the generic
 * `docs(collection, id, JSON)` table. Values are always bound (`?`); the `id`
 * column uses a binary collation for deterministic cursor ordering.
 */
const SAFE_FIELD = /^[A-Za-z0-9_]+$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const ID_TYPE = "VARCHAR(191) COLLATE utf8mb4_bin";

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

function isFkColumn(spec: TableSpec, field: string): boolean {
    return (spec.foreignKeys ?? []).some((fk) => fk.column === field);
}

/** MySQL column type. Key columns need a bounded VARCHAR (TEXT can't be indexed
 *  without a prefix); an FK column must match the referenced `id` type exactly. */
function mysqlType(spec: TableSpec, c: ColumnSpec): string {
    if (isFkColumn(spec, c.field)) return ID_TYPE;
    switch (c.kind) {
        case "boolean":
            return "TINYINT";
        case "integer":
            return "BIGINT";
        case "json":
            return "TEXT";
        case "text":
            if (c.unique) return "VARCHAR(320)"; // max email length
            if ((spec.indexes ?? []).includes(c.field)) return "VARCHAR(255)";
            return "TEXT";
    }
}

function createTypedTableSql(spec: TableSpec): string {
    const cols = spec.columns.map(
        (c) => `\`${c.field}\` ${mysqlType(spec, c)}${c.notNull ? " NOT NULL" : ""}${c.unique ? " UNIQUE" : ""}`,
    );
    const fks = (spec.foreignKeys ?? []).map(
        (fk) =>
            `FOREIGN KEY (\`${fk.column}\`) REFERENCES \`${fk.refTable}\`(\`${fk.refColumn}\`)` +
            (fk.onDelete === "cascade" ? " ON DELETE CASCADE" : fk.onDelete === "restrict" ? " ON DELETE RESTRICT" : ""),
    );
    const parts = [`id ${ID_TYPE} PRIMARY KEY`, ...cols, "extra TEXT NOT NULL", ...fks];
    return `CREATE TABLE IF NOT EXISTS \`${spec.table}\` (${parts.join(", ")}) DEFAULT CHARACTER SET utf8mb4`;
}

class MysqlStorageAdapter implements StorageAdapter {
  readonly #pool: mysql.Pool;

  constructor(pool: mysql.Pool) {
    this.#pool = pool;
  }

  async get<T extends StoredDoc = StoredDoc>(collection: string, id: string): Promise<Result<T | null>> {
    try {
        const spec = tableSpecFor(collection);
        if (spec) {
            const [rows] = await this.#pool.query(`SELECT *
                                                   FROM \`${spec.table}\`
                                                   WHERE id = ?`, [id]);
            const r = (rows as Record<string, unknown>[])[0];
            return ok(r ? rowToDoc<T>(spec, r) : null);
        }
        const [rows] = await this.#pool.query(`SELECT doc
                                               FROM docs
                                               WHERE collection = ?
                                                 AND id = ?`, [collection, id]);
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
        const spec = tableSpecFor(collection);
        if (spec) {
            const row = docToRow(spec, doc);
            const cols = typedColumns(spec);
            // Upsert keyed on the PRIMARY KEY only — existence check then UPDATE/INSERT
            // (NOT `ON DUPLICATE KEY UPDATE`, which fires on ANY unique key and would
            // overwrite a different row that shares the email instead of rejecting it).
            const [existing] = await this.#pool.query(`SELECT 1 FROM \`${spec.table}\` WHERE id = ? LIMIT 1`, [row["id"]]);
            if ((existing as unknown[]).length) {
                const setCols = cols.filter((c) => c !== "id");
                const setSql = setCols.map((c) => `\`${c}\`=?`).join(", ");
                await this.#pool.query(`UPDATE \`${spec.table}\` SET ${setSql} WHERE id = ?`, [
                    ...setCols.map((c) => row[c] as SqlValue),
                    row["id"],
                ]);
            } else {
                const colSql = cols.map((c) => `\`${c}\``).join(", ");
                const ph = cols.map(() => "?").join(", ");
                await this.#pool.query(
                    `INSERT INTO \`${spec.table}\` (${colSql}) VALUES (${ph})`,
                    cols.map((c) => row[c] as SqlValue),
                );
            }
            return ok(undefined);
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
        const spec = tableSpecFor(collection);
        if (spec) {
            await this.#pool.query(`DELETE FROM \`${spec.table}\` WHERE id = ?`, [id]);
            return ok(undefined);
        }
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
            const [rows] = await this.#pool.query(`SELECT 1 FROM \`${spec.table}\` LIMIT 1`);
            if ((rows as unknown[]).length) set.add(spec.collection);
        }
        const [docRows] = await this.#pool.query(`SELECT DISTINCT collection FROM docs ORDER BY collection`);
        for (const r of docRows as { collection: string }[]) set.add(r.collection);
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
                clauses.push(`id = ?`);
                params.push(String(value));
            } else {
                const col = colByField.get(field);
                if (col) {
                    clauses.push(`\`${field}\` = ?`);
                    params.push(toStore(col.kind, value));
                } else {
                    clauses.push(`JSON_UNQUOTE(JSON_EXTRACT(extra, '$.${field}')) = ?`);
                    params.push(String(value));
                }
            }
        }
        if (after !== null) {
            clauses.push(`id > ?`);
            params.push(after);
        }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const [rows] = await this.#pool.query(
            `SELECT * FROM \`${spec.table}\` ${where} ORDER BY id ASC LIMIT ?`,
            [...params, limit + 1],
        );
        const list = rows as Record<string, unknown>[];
        const hasMore = list.length > limit;
        const pageRows = hasMore ? list.slice(0, limit) : list;
        const last = pageRows[pageRows.length - 1];
        return {
            items: pageRows.map((r) => rowToDoc<T>(spec, r)),
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
        const clauses: string[] = [`collection = ?`];
        const params: (string | number)[] = [collection];
        for (const [field, value] of Object.entries(filter.where ?? {})) {
            if (!SAFE_FIELD.test(field)) throw new PressError("validation", `Invalid filter field: ${field}`);
            if (INDEX_FIELDS.has(field)) {
                clauses.push(`${indexedExpr(field)} = ?`);
                params.push(String(value));
            } else {
        clauses.push(`JSON_UNQUOTE(JSON_EXTRACT(doc, ?)) = ?`);
        params.push(`$.${field}`, String(value));
      }
        }
        if (after !== null) {
            clauses.push(`id > ?`);
            params.push(after);
        }
        const [rows] = await this.#pool.query(
            `SELECT id, doc FROM docs WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ?`,
            [...params, limit + 1],
        );
        const list = rows as { id: string; doc: unknown }[];
        const hasMore = list.length > limit;
        const pageRows = hasMore ? list.slice(0, limit) : list;
        const last = pageRows[pageRows.length - 1];
        return {items: pageRows.map((r) => parseDoc<T>(r.doc)), nextCursor: hasMore && last ? last.id : null};
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
    // Functional indexes on the hot filter fields for collections in `docs`.
    // MySQL has no `CREATE INDEX IF NOT EXISTS`, so tolerate "duplicate key name".
    for (const field of STORAGE_INDEX_FIELDS) {
        try {
            await pool.query(`CREATE INDEX idx_docs_${field} ON docs (collection, (${indexedExpr(field)}), id)`);
        } catch (e) {
            if ((e as { errno?: number }).errno !== 1061) throw e;
        }
    }
    // Normalized tables for host-owned collections (parents before children for FKs).
    for (const spec of TABLE_SPECS) {
        await pool.query(createTypedTableSql(spec));
        // FK columns are auto-indexed by InnoDB; only add explicit indexes for the rest.
        for (const field of spec.indexes ?? []) {
            if (isFkColumn(spec, field)) continue;
            try {
                await pool.query(`CREATE INDEX \`idx_${spec.table}_${field}\` ON \`${spec.table}\` (\`${field}\`)`);
            } catch (e) {
                if ((e as { errno?: number }).errno !== 1061) throw e;
            }
        }
    }
  return new MysqlStorageAdapter(pool);
}
