/**
 * Secondary-index hints for the document store.
 *
 * The store keeps every record as a JSON document in one `docs(collection, id,
 * doc)` table, so the primary key only accelerates lookups by id. These are the
 * fields that callers actually filter on (`query({ where: { … } })`) — derived
 * from every `where` clause in the codebase. Each adapter builds a real index
 * over the matching JSON path so those filters seek instead of scanning a whole
 * collection — the query speed of normalized columns without giving up the
 * no-code, user-defined content model.
 *
 * Field names here are also the allowlist of safely-indexable keys; they match
 * the adapters' `SAFE_FIELD` charset (`[A-Za-z0-9_]+`), so a name can be inlined
 * into a JSON path literal (required for an SQL expression index to be used)
 * with no injection risk.
 */
export interface StorageIndex {
    collection: string;
    field: string;
}

export const STORAGE_INDEXES: readonly StorageIndex[] = [
    {collection: "users", field: "email"},
    {collection: "sessions", field: "userId"},
    {collection: "invites", field: "tokenHash"},
    {collection: "content_entries", field: "status"},
    {collection: "content_entries", field: "slug"},
    {collection: "content_types", field: "slug"},
    {collection: "revisions", field: "entryId"},
    {collection: "jobs", field: "status"},
    {collection: "form_submissions", field: "subjectRef"},
    {collection: "media", field: "ownerRef"},
    {collection: "inventory_orders", field: "subjectRef"},
    {collection: "inventory_orders", field: "status"},
    {collection: "inventory_stock_movements", field: "itemId"},
];

/**
 * The distinct field names to index. The SQL adapters share ONE `docs` table,
 * so a single `(collection, <json field>, id)` index per field name serves
 * every collection that filters on it (the leading `collection` column scopes
 * it). Mongo indexes per (collection, field) instead — see STORAGE_INDEXES.
 */
export const STORAGE_INDEX_FIELDS: readonly string[] = [
    ...new Set(STORAGE_INDEXES.map((i) => i.field)),
];
