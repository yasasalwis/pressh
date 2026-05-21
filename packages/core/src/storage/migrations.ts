import type Database from "better-sqlite3";

type DB = Database.Database;

interface Migration {
  version: number;
  up: (db: DB) => void;
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
];

export function runMigrations(db: DB): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       version    INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     );`,
  );
  const appliedRows = db.prepare(`SELECT version FROM _migrations`).all() as { version: number }[];
  const applied = new Set(appliedRows.map((row) => row.version));

  const apply = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      migration.up(db);
      db.prepare(`INSERT INTO _migrations (version, applied_at) VALUES (?, ?)`).run(
        migration.version,
        new Date().toISOString(),
      );
    }
  });
  apply();
}
