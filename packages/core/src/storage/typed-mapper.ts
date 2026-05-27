import type {ColumnKind, TableSpec} from "./schema.js";
import type {StoredDoc} from "./types.js";

/**
 * Dialect-independent mapping between a JSON document and a normalized table
 * row, shared by every SQL adapter so the (correctness-critical) value coercion
 * and lossless round-trip live in ONE place. A UNIFORM storage scheme keeps the
 * mapping identical across SQLite/Postgres/MySQL:
 *   - text    → TEXT
 *   - integer → INTEGER/BIGINT, read back via Number() (handles bigint-as-string)
 *   - boolean → 0/1 in a small integer column (never a native bool type)
 *   - json    → JSON string in a TEXT column (never a native json type)
 * Only the SQL *generation* (quoting, placeholders, upsert, DDL types) differs
 * per adapter; this data mapping does not.
 */
export type SqlValue = string | number | null;

export function toStore(kind: ColumnKind, v: unknown): SqlValue {
    if (v === undefined || v === null) return null;
    switch (kind) {
        case "boolean":
            return v ? 1 : 0;
        case "json":
            return JSON.stringify(v);
        case "integer":
            return typeof v === "number" ? v : Number(v);
        case "text":
            return typeof v === "string" ? v : String(v);
    }
}

export function fromStore(kind: ColumnKind, v: unknown): unknown {
    if (v === null || v === undefined) return null;
    switch (kind) {
        case "boolean":
            return Boolean(Number(v)); // 0/1, or "0"/"1" from some drivers
        case "json":
            return JSON.parse(String(v));
        case "integer":
            return Number(v); // number, or bigint-as-string (node-pg int8)
        case "text":
            return String(v);
    }
}

/** Full ordered column list for a typed table: id, mapped fields, then extra. */
export function typedColumns(spec: TableSpec): string[] {
    return ["id", ...spec.columns.map((c) => c.field), "extra"];
}

/** Decompose a doc into column→value; fields without a column go to `extra`. */
export function docToRow(spec: TableSpec, doc: StoredDoc): Record<string, SqlValue> {
    const known = new Set<string>(["id"]);
    const row: Record<string, SqlValue> = {id: String(doc.id)};
    for (const c of spec.columns) {
        known.add(c.field);
        row[c.field] = toStore(c.kind, (doc as Record<string, unknown>)[c.field]);
    }
    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(doc)) if (!known.has(k)) extra[k] = (doc as Record<string, unknown>)[k];
    row["extra"] = JSON.stringify(extra);
    return row;
}

/** Reassemble the original doc from a typed-table row (column object). */
export function rowToDoc<T extends StoredDoc>(spec: TableSpec, row: Record<string, unknown>): T {
    const doc: Record<string, unknown> = {id: String(row["id"])};
    for (const c of spec.columns) {
        const raw = row[c.field];
        // An optional field that's NULL was absent in the original doc — keep it
        // absent rather than reviving it as `null`.
        if (c.optional && (raw === null || raw === undefined)) continue;
        doc[c.field] = fromStore(c.kind, raw);
    }
    Object.assign(doc, JSON.parse(String(row["extra"] ?? "{}")));
    return doc as T;
}
