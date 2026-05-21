import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Result, StorageAdapter } from "@pressh/core";

/**
 * Shared StorageAdapter conformance suite. Every adapter (FS, SQLite, Postgres,
 * Mongo) must pass the SAME tests — that is the Phase-16 acceptance criterion.
 */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

export function storageConformanceTests(
  label: string,
  make: () => Promise<StorageAdapter> | StorageAdapter,
  dispose: (adapter: StorageAdapter) => Promise<void> | void,
): void {
  describe(`StorageAdapter conformance: ${label}`, () => {
    let store: StorageAdapter;

    beforeEach(async () => {
      store = await make();
    });
    afterEach(async () => {
      await dispose(store);
    });

    it("round-trips a document", async () => {
      unwrap(await store.put("posts", { id: "p1", title: "Hello", status: "published" }));
      expect(unwrap(await store.get("posts", "p1"))).toEqual({
        id: "p1",
        title: "Hello",
        status: "published",
      });
    });

    it("returns null for a missing document", async () => {
      expect(unwrap(await store.get("posts", "nope"))).toBeNull();
    });

    it("deletes a document", async () => {
      unwrap(await store.put("posts", { id: "p1", title: "x" }));
      unwrap(await store.delete("posts", "p1"));
      expect(unwrap(await store.get("posts", "p1"))).toBeNull();
    });

    it("filters by an indexed field", async () => {
      unwrap(await store.put("posts", { id: "a", status: "published" }));
      unwrap(await store.put("posts", { id: "b", status: "draft" }));
      unwrap(await store.put("posts", { id: "c", status: "published" }));
      const page = unwrap(await store.query("posts", { where: { status: "published" } }));
      expect(page.items).toHaveLength(2);
    });

    it("paginates deterministically with a cursor", async () => {
      for (let i = 0; i < 5; i++) {
        unwrap(await store.put("posts", { id: `conf-${i}`, n: i }));
      }
      const seen = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: { items: { id: string }[]; nextCursor: string | null } = unwrap(
          await store.query("posts", {}, { limit: 2, after: cursor }),
        );
        for (const item of page.items) seen.add(item.id);
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 10);
      expect(seen.size).toBe(5);
      expect(pages).toBe(3);
    });

    it("lists collections that hold records", async () => {
      unwrap(await store.put("posts", { id: "p1" }));
      unwrap(await store.put("pages", { id: "g1" }));
      const collections = unwrap(await store.listCollections());
      expect(collections).toContain("posts");
      expect(collections).toContain("pages");
    });

    it("runs a transaction", async () => {
      const result = await store.transaction(async (tx) => {
        unwrap(await tx.put("posts", { id: "t1", x: 1 }));
        return "done";
      });
      expect(result.ok).toBe(true);
      expect(unwrap(await store.get("posts", "t1"))).not.toBeNull();
    });
  });
}
