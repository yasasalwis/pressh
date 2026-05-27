import type Database from "better-sqlite3";
import {STORAGE_INDEX_FIELDS} from "./indexes.js";

type DB = Database.Database;

interface Migration {
  version: number;
  up: (db: DB) => void;
}

/**
 * SQLite expression index for one hot field. Indexes `(collection,
 * json_extract(doc,'$.field'), id)` so a `WHERE collection=? AND
 * json_extract(doc,'$.field')=? … ORDER BY id` query both seeks the match and
 * walks the cursor in id order from the index alone. `field` is from the
 * STORAGE_INDEX_FIELDS allowlist (`[A-Za-z0-9_]+`), so inlining it into the
 * path literal — required for the planner to match this index — is injection-safe.
 */
function fieldIndexSql(field: string): string {
    return `CREATE INDEX IF NOT EXISTS idx_docs_${field} ON docs (collection, json_extract(doc, '$.${field}'), id);`;
}

/** Index schema migrations. The index is derived; canonical truth is the FS. */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(
        `CREATE TABLE IF NOT EXISTS docs (
           collection TEXT NOT NULL,
           id         TEXT NOT NULL,
           doc        TEXT NOT NULL,
           PRIMARY KEY (collection, id)
         );
         CREATE INDEX IF NOT EXISTS idx_docs_collection ON docs (collection, id);`,
      );
    },
  },
    {
        version: 2,
        up: (db) => {
            // Secondary expression indexes on the fields callers actually filter on.
            for (const field of STORAGE_INDEX_FIELDS) db.exec(fieldIndexSql(field));
        },
    },
];

export function runMigrations(db: DB): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       version    INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     );`,
  );
  // Run under BEGIN IMMEDIATE so concurrent processes (the two-process trust
  // split shares this index) serialize: the second waits for the write lock,
  // then re-reads applied state INSIDE the transaction and skips. INSERT OR
  // IGNORE is a final guard against a duplicate-version race.
  const apply = db.transaction(() => {
    const applied = new Set(
      (db.prepare(`SELECT version FROM _migrations`).all() as { version: number }[]).map(
        (row) => row.version,
      ),
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      migration.up(db);
      db.prepare(`INSERT OR IGNORE INTO _migrations (version, applied_at) VALUES (?, ?)`).run(
        migration.version,
        new Date().toISOString(),
      );
    }
  });
  apply.immediate();
}
