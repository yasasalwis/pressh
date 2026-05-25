import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileSystemStorage } from "@pressh/core";
import type { Result, StorageAdapter, StoredDoc } from "@pressh/core";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

let dir: string;
let store: StorageAdapter;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-store-"));
  store = createFileSystemStorage({ root: dir });
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe("FileSystemStorageAdapter — CRUD", () => {
  it("round-trips a document", async () => {
    const id = randomUUID();
    unwrap(await store.put("posts", { id, title: "Hello", status: "published" }));
    const got = unwrap(await store.get("posts", id));
    expect(got).toEqual({ id, title: "Hello", status: "published" });
  });

  it("returns null for a missing document", async () => {
    expect(unwrap(await store.get("posts", randomUUID()))).toBeNull();
  });

  it("deletes a document", async () => {
    const id = randomUUID();
    unwrap(await store.put("posts", { id, title: "x" }));
    unwrap(await store.delete("posts", id));
    expect(unwrap(await store.get("posts", id))).toBeNull();
  });
});

describe("FileSystemStorageAdapter — transactions", () => {
    it("commits all writes when the body succeeds", async () => {
        const result = await store.transaction(async (tx) => {
            unwrap(await tx.put("posts", {id: "a", n: 1}));
            unwrap(await tx.put("posts", {id: "b", n: 2}));
            return "ok";
        });
        expect(result.ok).toBe(true);
        expect(unwrap(await store.get("posts", "a"))).not.toBeNull();
        expect(unwrap(await store.get("posts", "b"))).not.toBeNull();
    });

    it("rolls back every write (and restores overwritten rows) when the body throws", async () => {
        unwrap(await store.put("posts", {id: "keep", title: "original"}));
        const result = await store.transaction(async (tx) => {
            unwrap(await tx.put("posts", {id: "keep", title: "modified"}));
            unwrap(await tx.put("posts", {id: "new", title: "added"}));
            unwrap(await tx.delete("posts", "keep")); // even a delete is undone
            throw new Error("boom");
        });
        expect(result.ok).toBe(false);
        expect(unwrap(await store.get("posts", "new"))).toBeNull();
        expect(unwrap(await store.get<{ title: string }>("posts", "keep"))?.title).toBe("original");
    });
});

describe("FileSystemStorageAdapter — query", () => {
  it("filters by an indexed top-level field", async () => {
    await store.put("posts", { id: randomUUID(), status: "published" });
    await store.put("posts", { id: randomUUID(), status: "draft" });
    await store.put("posts", { id: randomUUID(), status: "published" });

    const page = unwrap(await store.query("posts", { where: { status: "published" } }));
    expect(page.items).toHaveLength(2);
    expect(page.items.every((p) => p["status"] === "published")).toBe(true);
  });

  it("paginates deterministically with a cursor", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      ids.push(id);
      await store.put("posts", { id, n: i });
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { items: StoredDoc[]; nextCursor: string | null } = unwrap(
        await store.query("posts", {}, { limit: 2, after: cursor }),
      );
      for (const item of page.items) seen.add(item.id);
      cursor = page.nextCursor;
      pages++;
      expect(page.items.length).toBeLessThanOrEqual(2);
    } while (cursor !== null && pages < 10);

    expect(seen.size).toBe(5);
    expect(pages).toBe(3); // 2 + 2 + 1
  });
});

describe("FileSystemStorageAdapter — security guards", () => {
  it("rejects a traversal id", async () => {
    const result = await store.put("posts", { id: "../evil" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation");
  });

  it("rejects a traversal collection", async () => {
    const result = await store.get("../secrets", randomUUID());
    expect(result.ok).toBe(false);
  });

  it("rejects an unsafe filter field", async () => {
    const result = await store.query("posts", { where: { "a'; DROP": "x" } });
    expect(result.ok).toBe(false);
  });
});

describe("FileSystemStorageAdapter — index rebuild", () => {
  it("produces identical query results after rebuild", async () => {
    for (let i = 0; i < 4; i++) {
      await store.put("posts", { id: randomUUID(), n: i });
    }
    const before = unwrap(await store.query("posts"));
    unwrap(await store.rebuildIndex());
    const after = unwrap(await store.query("posts"));
    expect(after.items).toEqual(before.items);
  });

  it("rebuilds a fresh, empty index from the canonical files", async () => {
    for (let i = 0; i < 3; i++) {
      await store.put("posts", { id: randomUUID(), n: i });
    }
    const original = unwrap(await store.query("posts"));

    // A brand-new index pointing at the same content root: empty until rebuilt.
    const fresh = createFileSystemStorage({ root: dir, indexPath: join(dir, "fresh.sqlite") });
    expect(unwrap(await fresh.query("posts")).items).toHaveLength(0);
    unwrap(await fresh.rebuildIndex());
    expect(unwrap(await fresh.query("posts")).items).toEqual(original.items);
    fresh.close();
  });
});
