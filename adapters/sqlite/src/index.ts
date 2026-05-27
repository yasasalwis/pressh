import {mkdirSync} from "node:fs";
import {dirname} from "node:path";
import Database from "better-sqlite3";
import type {
    ColumnKind,
    Cursor,
    Filter,
    Page,
    Result,
    SqlValue,
    StorageAdapter,
    StoredDoc,
    TableSpec
} from "@pressh/core";
import {
    docToRow,
    PressError,
    rowToDoc,
    STORAGE_INDEX_FIELDS,
    TABLE_SPECS,
    tableSpecFor,
    toStore,
    typedColumns
} from "@pressh/core";

/**
 * SQLite StorageAdapter — SQLite is the canonical store (not just an index).
 *
 * Host-owned, fixed-shape collections (users, sessions, …; see TABLE_SPECS) map
 * to NORMALIZED tables: typed columns, UNIQUE/FOREIGN-KEY constraints and real
 * indexes, with an `extra` JSON column that losslessly preserves any field not
 * given a column. Every other collection (plugin-owned / arbitrary) lives in the
 * generic `docs(collection, id, doc)` table. Both paths present identical
 * StorageAdapter behavior; filters use parameterized/allowlisted SQL only, and
 * pagination is a stable id-ordered cursor.
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

const sqlType = (kind: ColumnKind): string => (kind === "integer" || kind === "boolean" ? "INTEGER" : "TEXT");

function createTypedTableSql(spec: TableSpec): string {
    const cols = spec.columns.map(
        (c) => `"${c.field}" ${sqlType(c.kind)}${c.notNull ? " NOT NULL" : ""}${c.unique ? " UNIQUE" : ""}`,
    );
    const fks = (spec.foreignKeys ?? []).map(
        (fk) =>
            `FOREIGN KEY ("${fk.column}") REFERENCES "${fk.refTable}"("${fk.refColumn}")` +
            (fk.onDelete === "cascade" ? " ON DELETE CASCADE" : fk.onDelete === "restrict" ? " ON DELETE RESTRICT" : ""),
    );
    const parts = ["id TEXT PRIMARY KEY", ...cols, "extra TEXT NOT NULL DEFAULT '{}'", ...fks];
    return `CREATE TABLE IF NOT EXISTS "${spec.table}" (${parts.join(", ")});`;
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
      // Enforce foreign keys (off by default in SQLite) so the normalized tables'
      // referential integrity actually holds.
      this.#db.pragma("foreign_keys = ON");
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
      // Expression indexes on the hot filter fields for collections still in the
      // doc table: (collection, json field, id) so a filtered, id-paginated query
      // seeks instead of scanning. `field` is from the allowlist, so the inlined
      // path is safe.
      for (const field of STORAGE_INDEX_FIELDS) {
          this.#db.exec(
              `CREATE INDEX IF NOT EXISTS idx_docs_${field} ON docs (collection, json_extract(doc, '$.${field}'), id);`,
          );
      }
      // Normalized tables for host-owned collections. TABLE_SPECS lists parents
      // before children, so a FK's referenced table already exists.
      for (const spec of TABLE_SPECS) {
          this.#db.exec(createTypedTableSql(spec));
          for (const field of spec.indexes ?? []) {
              this.#db.exec(`CREATE INDEX IF NOT EXISTS "idx_${spec.table}_${field}" ON "${spec.table}" ("${field}");`);
          }
          // Add any columns present in the spec but missing from the live table.
          // SQLite only supports ADD COLUMN (no DROP, no type change), which is
          // exactly what we need for forward-only schema evolution.
          const existing = new Set(
              (this.#db.pragma(`table_info("${spec.table}")`) as { name: string }[]).map((r) => r.name),
          );
          for (const col of spec.columns) {
              if (!existing.has(col.field)) {
                  const colDef = `${sqlType(col.kind)}${col.notNull ? " NOT NULL DEFAULT ''" : ""}`;
                  this.#db.exec(`ALTER TABLE "${spec.table}"
                      ADD COLUMN "${col.field}" ${colDef};`);
              }
          }
      }
  }

  async get<T extends StoredDoc = StoredDoc>(collection: string, id: string): Promise<Result<T | null>> {
    try {
        const spec = tableSpecFor(collection);
        if (spec) {
            const row = this.#db.prepare(`SELECT * FROM "${spec.table}" WHERE id = ?`).get(id) as
                | Record<string, unknown>
                | undefined;
            return ok(row ? rowToDoc<T>(spec, row) : null);
        }
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
        const spec = tableSpecFor(collection);
        if (spec) {
            const row = docToRow(spec, doc);
            const cols = typedColumns(spec);
            const colSql = cols.map((c) => `"${c}"`).join(", ");
            const placeholders = cols.map(() => "?").join(", ");
            // Upsert via ON CONFLICT (NOT INSERT OR REPLACE): REPLACE deletes the row
            // first, which would fire ON DELETE CASCADE and wipe child rows on every
            // update. DO UPDATE edits in place.
            const updates = cols.filter((c) => c !== "id").map((c) => `"${c}"=excluded."${c}"`).join(", ");
            this.#db
                .prepare(
                    `INSERT INTO "${spec.table}" (${colSql}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
                )
                .run(...cols.map((c) => row[c] as SqlValue));
            return ok(undefined);
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
        const spec = tableSpecFor(collection);
        if (spec) {
            this.#db.prepare(`DELETE FROM "${spec.table}" WHERE id = ?`).run(id);
            return ok(undefined);
        }
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
        const limit = Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
        const after = page.after ?? null;
        const spec = tableSpecFor(collection);
        if (spec) return ok(this.#queryTyped<T>(spec, filter, after, limit));
        return ok(this.#queryDocs<T>(collection, filter, after, limit));
    } catch (e) {
        return fail(e);
    }
  }

  async listCollections(): Promise<Result<string[]>> {
    try {
        const set = new Set<string>();
        // Normalized tables that currently hold at least one row.
        for (const spec of TABLE_SPECS) {
            if (this.#db.prepare(`SELECT 1 FROM "${spec.table}" LIMIT 1`).get()) set.add(spec.collection);
        }
      const rows = this.#db
        .prepare(`SELECT DISTINCT collection FROM docs ORDER BY collection`)
        .all() as { collection: string }[];
        for (const r of rows) set.add(r.collection);
        return ok([...set].sort());
    } catch (e) {
      return fail(e);
    }
  }

    #queryTyped<T extends StoredDoc>(spec: TableSpec, filter: Filter, after: string | null, limit: number): Page<T> {
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
                    clauses.push(`"${field}" = ?`);
                    params.push(toStore(col.kind, value));
                } else {
                    // A field not promoted to a column lives in `extra`.
                    clauses.push(`json_extract(extra, '$.${field}') = ?`);
                    params.push(typeof value === "boolean" ? (value ? 1 : 0) : (value as SqlValue));
                }
            }
        }
        if (after !== null) {
            clauses.push(`id > ?`);
            params.push(after);
        }
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        const rows = this.#db
            .prepare(`SELECT * FROM "${spec.table}" ${where} ORDER BY id ASC LIMIT ?`)
            .all(...params, limit + 1) as Record<string, unknown>[];
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const last = pageRows[pageRows.length - 1];
        return {
            items: pageRows.map((r) => rowToDoc<T>(spec, r)),
            nextCursor: hasMore && last ? String(last["id"]) : null,
        };
    }

  async transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<Result<T>> {
      // Already inside a transaction (nested call): join it. Let a throw propagate
      // so the outermost transaction performs a single unified ROLLBACK.
      if (this.#db.inTransaction) {
      return ok(await fn(this));
      }
      // Real atomicity: COMMIT only if `fn` resolves; ROLLBACK on any throw so a
      // partial multi-write never persists. (better-sqlite3 ops are synchronous,
      // so the writes inside `fn` run within this BEGIN/COMMIT span.)
      this.#db.exec("BEGIN");
      try {
          const value = await fn(this);
          this.#db.exec("COMMIT");
          return ok(value);
    } catch (e) {
          try {
              this.#db.exec("ROLLBACK");
          } catch {
              // No active transaction to roll back — nothing to undo.
          }
      return fail(e);
    }
  }

    #queryDocs<T extends StoredDoc>(collection: string, filter: Filter, after: string | null, limit: number): Page<T> {
        const clauses: string[] = [`collection = ?`];
        const params: SqlValue[] = [collection];
        for (const [field, value] of Object.entries(filter.where ?? {})) {
            if (!SAFE_FIELD.test(field)) throw new PressError("validation", `Invalid filter field: ${field}`);
            clauses.push(`json_extract(doc, '$.${field}') = ?`);
            params.push(typeof value === "boolean" ? (value ? 1 : 0) : (value as SqlValue));
        }
        if (after !== null) {
            clauses.push(`id > ?`);
            params.push(after);
        }
        const rows = this.#db
            .prepare(`SELECT id, doc FROM docs WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ?`)
            .all(...params, limit + 1) as DocRow[];
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const last = pageRows[pageRows.length - 1];
        return {
            items: pageRows.map((r) => JSON.parse(r.doc) as T),
            nextCursor: hasMore && last ? last.id : null,
        };
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
