import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileSystemStorage, migrateStorage } from "@pressh/core";
import type { Result, StorageAdapter } from "@pressh/core";
import { createSqliteStorage } from "@pressh/adapter-sqlite";

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw r.error;
  return r.value;
}

let dir: string;
let fs: StorageAdapter;
let db: StorageAdapter;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-migrate-"));
  fs = createFileSystemStorage({ root: join(dir, "content") });
  db = createSqliteStorage({ path: ":memory:" });
});
afterEach(async () => {
  fs.close();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("FS → SQLite migration", () => {
  it("copies all content and revisions intact", async () => {
    unwrap(await fs.put("content_types", { id: "t1", name: "Page" }));
    unwrap(await fs.put("content_entries", { id: "e1", typeId: "t1", slug: "about", status: "published" }));
    unwrap(await fs.put("revisions", { id: "e1.1", entryId: "e1", version: 1, fields: { title: "About" } }));
    unwrap(await fs.put("revisions", { id: "e1.2", entryId: "e1", version: 2, fields: { title: "About 2" } }));

    const summary = unwrap(await migrateStorage(fs, db));
    expect(summary.records).toBe(4);
    expect(summary.collections).toBe(3);

    expect(unwrap(await db.get("content_entries", "e1"))).toMatchObject({ slug: "about" });
    const revs = unwrap(await db.query("revisions", { where: { entryId: "e1" } }));
    expect(revs.items).toHaveLength(2);
    expect(unwrap(await db.listCollections()).sort()).toEqual([
      "content_entries",
      "content_types",
      "revisions",
    ]);
  });
});
