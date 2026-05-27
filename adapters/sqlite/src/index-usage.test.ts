import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {createSqliteStorage} from "@pressh/adapter-sqlite";

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sqlite-idx-"));
});
afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
});

describe("SqliteStorageAdapter — secondary indexes", () => {
    it("uses an expression index for a filtered, id-paginated query", async () => {
        const path = join(dir, "db.sqlite");
        const store = createSqliteStorage({path});
        for (let i = 0; i < 30; i++) {
            await store.put("content_entries", {id: `e${i}`, status: i % 2 ? "draft" : "published", slug: `p${i}`});
        }
        store.close();

        const db = new Database(path, {readonly: true});
        const detail = db
            .prepare(
                "EXPLAIN QUERY PLAN SELECT id, doc FROM docs WHERE collection = ? AND json_extract(doc, '$.status') = ? AND id > ? ORDER BY id ASC LIMIT ?",
            )
            .all("content_entries", "published", "", 50)
            .map((r) => (r as { detail: string }).detail)
            .join(" | ");
        db.close();

        expect(detail).toContain("USING INDEX idx_docs_status");
        expect(detail).not.toContain("SCAN");
    });

    it("returns correct results for an indexed filter", async () => {
        const store = createSqliteStorage({path: ":memory:"});
        await store.put("users", {id: "u1", email: "a@b.c"});
        await store.put("users", {id: "u2", email: "x@y.z"});
        const page = await store.query("users", {where: {email: "x@y.z"}});
        expect(page.ok && page.value.items.map((i) => i.id)).toEqual(["u2"]);
        store.close();
    });
});
