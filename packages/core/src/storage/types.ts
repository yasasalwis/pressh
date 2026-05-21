import type { Result } from "../result.js";

/** A stored record: an arbitrary JSON object keyed by a string `id` (a UUID). */
export interface StoredDoc {
  id: string;
  [key: string]: unknown;
}

/** Equality filter over top-level scalar fields of the stored document. */
export interface Filter {
  where?: Record<string, string | number | boolean>;
}

/** Opaque, id-ordered cursor for stable pagination. */
export interface Cursor {
  limit?: number;
  after?: string | null;
}

export interface Page<T = StoredDoc> {
  items: T[];
  nextCursor: string | null;
}

/**
 * The single storage contract. The filesystem adapter ships in core; database
 * adapters (Postgres/SQLite/Mongo) implement the same interface in Phase 16.
 * Plugins never touch this directly — `raw` access is gated behind the
 * `storage.raw` capability (Phase 8).
 */
export interface StorageAdapter {
  get<T extends StoredDoc = StoredDoc>(collection: string, id: string): Promise<Result<T | null>>;
  put(collection: string, doc: StoredDoc): Promise<Result<void>>;
  delete(collection: string, id: string): Promise<Result<void>>;
  query<T extends StoredDoc = StoredDoc>(
    collection: string,
    filter?: Filter,
    page?: Cursor,
  ): Promise<Result<Page<T>>>;
  transaction<T>(fn: (tx: StorageAdapter) => Promise<T>): Promise<Result<T>>;
  /** Lists the collections that currently hold at least one record. */
  listCollections(): Promise<Result<string[]>>;
  /** Rebuilds the derived index from the canonical files. Idempotent (no-op for DB adapters). */
  rebuildIndex(): Promise<Result<void>>;
  close(): void;
}
