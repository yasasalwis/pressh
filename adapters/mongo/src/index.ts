import { MongoClient } from "mongodb";
import type { Db, Filter as MongoFilter } from "mongodb";
import { PressError } from "@pressh/core";
import type { Cursor, Filter, Page, Result, StorageAdapter, StoredDoc } from "@pressh/core";

/**
 * MongoDB StorageAdapter. Each Pressh collection maps to a Mongo collection;
 * the document's `id` is used as the Mongo `_id` (a string). Filters are passed
 * as structured query objects (never string-built). Pagination is a stable
 * `_id`-ordered cursor.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
// Filter keys must be plain field names; values must be scalars. This stops a
// caller from smuggling Mongo operators (e.g. `{$ne:null}`, `$where`) through
// the equality-only Filter contract — matching the SQLite/Postgres adapters.
const SAFE_FIELD = /^[A-Za-z0-9_]+$/;

/** Mongo documents use a string `_id` (the Pressh id). */
interface MongoDoc {
  _id: string;
  [key: string]: unknown;
}

export interface MongoStorageOptions {
  url: string;
  database?: string;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
function fail(e: unknown): Result<never> {
  // Never surface the raw driver error (it can include the connection string /
  // host) to callers; wrap unknown errors in a generic message.
  return { ok: false, error: e instanceof PressError ? e : new PressError("internal", "Storage backend error") };
}

function strip<T extends StoredDoc>(raw: MongoDoc | null): T | null {
  if (!raw) return null;
  const { _id, ...rest } = raw;
  void _id;
  return rest as T;
}

class MongoStorageAdapter implements StorageAdapter {
  readonly #client: MongoClient;
  readonly #db: Db;

  constructor(client: MongoClient, db: Db) {
    this.#client = client;
    this.#db = db;
  }

  #col(collection: string) {
    return this.#db.collection<MongoDoc>(collection);
  }

  async get<T extends StoredDoc = StoredDoc>(collection: string, id: string): Promise<Result<T | null>> {
    try {
      const raw = await this.#col(collection).findOne({ _id: id });
      return ok(strip<T>(raw));
    } catch (e) {
      return fail(e);
    }
  }

  async put(collection: string, doc: StoredDoc): Promise<Result<void>> {
    try {
      if (typeof doc.id !== "string" || doc.id.length === 0) {
        throw new PressError("validation", "Document must have a non-empty string id");
      }
      await this.#col(collection).replaceOne({ _id: doc.id }, { ...doc }, { upsert: true });
      return ok(undefined);
    } catch (e) {
      return fail(e);
    }
  }

  async delete(collection: string, id: string): Promise<Result<void>> {
    try {
      await this.#col(collection).deleteOne({ _id: id });
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
      const mongoFilter: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(filter.where ?? {})) {
        if (!SAFE_FIELD.test(field)) throw new PressError("validation", `Invalid filter field: ${field}`);
        if (value !== null && typeof value === "object") {
          throw new PressError("validation", `Invalid filter value for field: ${field}`);
        }
        mongoFilter[field] = value;
      }
      if (page.after) mongoFilter["_id"] = { $gt: page.after };
      const limit = Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const rows = await this.#col(collection)
        .find(mongoFilter)
        .sort({ _id: 1 })
        .limit(limit + 1)
        .toArray();

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const last = pageRows[pageRows.length - 1];
      return ok({
        items: pageRows.map((r) => strip<T>(r) as T),
        nextCursor: hasMore && last ? String(last._id) : null,
      });
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
      const names = await this.#db.listCollections({}, { nameOnly: true }).toArray();
      return ok(names.map((c) => c.name).sort());
    } catch (e) {
      return fail(e);
    }
  }

  async rebuildIndex(): Promise<Result<void>> {
    return ok(undefined); // Mongo is the canonical store.
  }

  close(): void {
    void this.#client.close();
  }
}

export async function createMongoStorage(opts: MongoStorageOptions): Promise<StorageAdapter> {
  const client = new MongoClient(opts.url);
  await client.connect();
  return new MongoStorageAdapter(client, client.db(opts.database ?? "pressh"));
}
