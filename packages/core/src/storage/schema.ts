/**
 * Declarative typed-table schema for host-owned, fixed-shape collections.
 *
 * On a SQL backend these collections map to NORMALIZED tables — typed columns,
 * UNIQUE / FOREIGN KEY constraints, real indexes — instead of the generic
 * `docs(collection, id, doc)` JSON table. Any doc field not declared as a
 * column is preserved losslessly in an `extra` JSON column, so adding a field
 * to an entity round-trips even before a column exists for it (the adapters
 * stay decoupled from minor shape changes).
 *
 * Plugin-owned / arbitrary collections (and every collection on MongoDB or the
 * filesystem default) keep the document model — they have no fixed schema.
 *
 * Column `field` names are also the SQL column names; they are constrained to
 * the `[A-Za-z0-9_]+` charset so they can be safely quoted into DDL/SQL.
 */
export type ColumnKind = "text" | "integer" | "boolean" | "json";

export interface ColumnSpec {
    /** Doc field name === SQL column name (`[A-Za-z0-9_]+`). */
    field: string;
    kind: ColumnKind;
    notNull?: boolean;
    unique?: boolean;
    /**
     * The doc field is optional. When the stored value is NULL it is OMITTED from
     * the reconstructed doc (absent stays absent), rather than coming back as
     * `null`. Use only for genuinely-optional fields (e.g. `system?`), never for
     * fields whose `null` is meaningful (e.g. `publishedAt: string | null`).
     */
    optional?: boolean;
}

export interface ForeignKeySpec {
    column: string;
    refTable: string;
    refColumn: string;
    onDelete?: "cascade" | "restrict";
}

export interface TableSpec {
    collection: string;
    table: string;
    /** Mapped columns. `id TEXT PRIMARY KEY` is implicit and always present. */
    columns: ColumnSpec[];
    /** Single-column secondary indexes (by field name). */
    indexes?: string[];
    foreignKeys?: ForeignKeySpec[];
}

export const TABLE_SPECS: readonly TableSpec[] = [
    {
        collection: "users",
        table: "users",
        columns: [
            {field: "email", kind: "text", notNull: true, unique: true},
            {field: "passwordHash", kind: "text"},
            {field: "status", kind: "text"},
            {field: "mustChangePassword", kind: "boolean"},
            {field: "failedAttempts", kind: "integer"},
            {field: "lockedUntil", kind: "integer"},
            {field: "mfaEnabled", kind: "boolean"},
            {field: "roles", kind: "json"},
            {field: "createdAt", kind: "text"},
        ],
    },
    {
        collection: "sessions",
        table: "sessions",
        columns: [
            {field: "userId", kind: "text", notNull: true},
            {field: "createdAt", kind: "text"},
            {field: "expiresAt", kind: "integer"},
            {field: "revoked", kind: "boolean"},
        ],
        indexes: ["userId"],
        foreignKeys: [{column: "userId", refTable: "users", refColumn: "id", onDelete: "cascade"}],
    },
    {
        collection: "invites",
        table: "invites",
        columns: [
            {field: "email", kind: "text", notNull: true},
            {field: "roles", kind: "json"},
            {field: "tokenHash", kind: "text"},
            {field: "invitedBy", kind: "text"}, // string | null (a deleted inviter stays referenced by id)
            {field: "expiresAt", kind: "integer"},
            {field: "consumedAt", kind: "text"}, // string | null
            {field: "createdAt", kind: "text"},
        ],
        indexes: ["tokenHash"],
    },
    // content_types precedes content_entries precedes revisions so the FK targets
    // exist when the tables are created and when a migration copies them.
    {
        collection: "content_types",
        table: "content_types",
        columns: [
            {field: "name", kind: "text"},
            {field: "slug", kind: "text", notNull: true},
            {field: "fields", kind: "json"}, // FieldDef[] — the type's field schema
            {field: "createdAt", kind: "text"},
        ],
        indexes: ["slug"],
    },
    {
        collection: "content_entries",
        table: "content_entries",
        columns: [
            {field: "typeId", kind: "text"},
            {field: "slug", kind: "text"},
            {field: "locale", kind: "text"},
            {field: "status", kind: "text"},
            {field: "authorId", kind: "text"},
            {field: "currentRevision", kind: "integer"},
            {field: "publishedAt", kind: "text"}, // string | null (null = not published)
            {field: "scheduledFor", kind: "text"}, // string | null
            {field: "createdAt", kind: "text"},
            {field: "updatedAt", kind: "text"},
            {field: "system", kind: "boolean", optional: true}, // only on built-in system pages
            {field: "requiresMembership", kind: "boolean", optional: true}, // gate for members-only content
        ],
        indexes: ["status", "slug"],
        // RESTRICT, not CASCADE: deleting a content type that still has entries is
        // refused rather than silently destroying all its content.
        foreignKeys: [{column: "typeId", refTable: "content_types", refColumn: "id", onDelete: "restrict"}],
    },
    {
        collection: "revisions",
        table: "revisions",
        columns: [
            {field: "entryId", kind: "text", notNull: true},
            {field: "version", kind: "integer"},
            {field: "fields", kind: "json"},
            {field: "blocks", kind: "json"},
            {field: "editorId", kind: "text"},
            {field: "createdAt", kind: "text"},
        ],
        indexes: ["entryId"],
        // CASCADE: a revision belongs to its entry; removing the entry removes them.
        foreignKeys: [{column: "entryId", refTable: "content_entries", refColumn: "id", onDelete: "cascade"}],
    },
    // ── standalone host-owned collections (no foreign keys) ─────────────────────
    {
        collection: "jobs",
        table: "jobs",
        columns: [
            {field: "type", kind: "text"},
            {field: "runAt", kind: "integer"},
            {field: "payload", kind: "json"},
            {field: "status", kind: "text"},
            {field: "attempts", kind: "integer"},
            {field: "createdAt", kind: "text"},
        ],
        indexes: ["status"], // the scheduler polls WHERE status = 'pending'
    },
    {
        collection: "plugin_state",
        table: "plugin_state",
        columns: [{field: "enabled", kind: "boolean"}], // id is the plugin name
    },
    {
        collection: "media",
        table: "media",
        columns: [
            {field: "filename", kind: "text"},
            {field: "mime", kind: "text"},
            {field: "ext", kind: "text"},
            {field: "size", kind: "integer"},
            {field: "path", kind: "text"}, // path to the binary on disk; bytes are NOT in the DB
            {field: "createdAt", kind: "text"},
        ],
    },
    {
        collection: "consent_records",
        table: "consent_records",
        columns: [
            {field: "subjectRef", kind: "text"},
            {field: "scope", kind: "text"},
            {field: "granted", kind: "boolean"},
            {field: "at", kind: "text"},
        ],
        indexes: ["subjectRef"], // GDPR export/erase queries by subject
    },
    {
      collection: "gdpr_tombstones",
      table: "gdpr_tombstones",
        columns: [
          {field: "subject", kind: "text"}, // subject HASH only — no raw PII retained
          {field: "erasedCount", kind: "integer"},
          {field: "erasedAt", kind: "text"},
        ],
    },
    // ── site-facing member (public user) collections ────────────────────────────
    {
        collection: "member_accounts",
        table: "member_accounts",
        columns: [
            {field: "email", kind: "text", notNull: true, unique: true},
            {field: "passwordHash", kind: "text"}, // null for magic-link-only members
            {field: "displayName", kind: "text", notNull: true},
            {field: "avatarUrl", kind: "text"}, // null until set
            {field: "bio", kind: "text"}, // null until set
            {field: "emailVerified", kind: "boolean"},
            {field: "status", kind: "text"}, // "active" | "suspended"
            {field: "failedAttempts", kind: "integer"},
            {field: "lockedUntil", kind: "integer"}, // null = not locked; unix ms otherwise
            {field: "createdAt", kind: "text"},
            {field: "updatedAt", kind: "text"},
        ],
    },
    {
        collection: "member_sessions",
        table: "member_sessions",
        columns: [
            {field: "memberId", kind: "text", notNull: true},
            {field: "expiresAt", kind: "integer"},
            {field: "createdAt", kind: "text"},
        ],
        indexes: ["memberId"],
        foreignKeys: [
            {column: "memberId", refTable: "member_accounts", refColumn: "id", onDelete: "cascade"},
        ],
    },
    {
        collection: "member_tokens",
        table: "member_tokens",
        columns: [
            {field: "memberId", kind: "text", notNull: true},
            {field: "email", kind: "text", notNull: true}, // denormalised for reference without a join
            {field: "type", kind: "text"}, // "email_verify" | "magic_link" | "pw_reset"
            {field: "tokenHash", kind: "text"}, // SHA-256 of the raw token
            {field: "expiresAt", kind: "integer"},
            {field: "usedAt", kind: "text"}, // null = not yet consumed
            {field: "createdAt", kind: "text"},
        ],
        indexes: ["tokenHash", "memberId"],
        foreignKeys: [
            {column: "memberId", refTable: "member_accounts", refColumn: "id", onDelete: "cascade"},
        ],
    },
  // NOTE: `settings` is intentionally NOT normalized. It is a POLYMORPHIC
  // singleton collection — it holds both the `general` settings doc and the
  // `theme` doc (different shapes) keyed by id — so a single typed table can't
  // model it. It stays in the document store, where heterogeneous shapes
  // round-trip losslessly.
];

export function tableSpecFor(collection: string): TableSpec | undefined {
    return TABLE_SPECS.find((s) => s.collection === collection);
}
