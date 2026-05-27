import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import type {Result, StorageAdapter} from "@pressh/core";
import {createAuthService, createFileAuditLog, createScheduler} from "@pressh/core";
import {createContentService} from "@pressh/engine";
import {createSqliteStorage} from "@pressh/adapter-sqlite";

function unwrap<T>(r: Result<T>): T {
    if (!r.ok) throw r.error;
    return r.value;
}

let dir: string;
let store: StorageAdapter;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sqlite-typed-"));
    store = createSqliteStorage({path: ":memory:"});
});
afterEach(async () => {
    store.close();
    await rm(dir, {recursive: true, force: true});
});

const sampleUser = (id: string, email: string) => ({
    id,
    email,
    passwordHash: "hash",
    roles: ["owner", "editor"],
    mfaEnabled: false,
    status: "active",
    mustChangePassword: false,
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: "2026-01-01T00:00:00.000Z",
});

describe("SqliteStorageAdapter — normalized typed tables", () => {
    it("losslessly round-trips a user (arrays, booleans, null, and unmapped extras)", async () => {
        const doc = {...sampleUser("u1", "a@b.c"), customFlag: true, nested: {a: 1}};
        unwrap(await store.put("users", doc));
        expect(unwrap(await store.get("users", "u1"))).toEqual(doc);
    });

    it("stores users in a real `users` table, not the docs blob", async () => {
        const path = join(dir, "db.sqlite");
        const fileStore = createSqliteStorage({path});
        unwrap(await fileStore.put("users", sampleUser("u1", "a@b.c")));
        // Queryable as a first-class column.
        expect(unwrap(await fileStore.query("users", {where: {email: "a@b.c"}})).items.map((u) => u.id)).toEqual([
            "u1",
        ]);
        fileStore.close();
        // Inspect the physical layout: the row is in the typed `users` table and the
        // generic `docs` table holds nothing for users.
        const db = new Database(path, {readonly: true});
        const usersCount = (db.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
        const docsCount = (db.prepare("SELECT count(*) AS n FROM docs WHERE collection = 'users'").get() as {
            n: number
        }).n;
        const emailType = (db.prepare("SELECT email FROM users WHERE id = 'u1'").get() as { email: string }).email;
        db.close();
        expect(usersCount).toBe(1);
        expect(docsCount).toBe(0);
        expect(emailType).toBe("a@b.c");
    });

    it("enforces the UNIQUE email constraint", async () => {
        unwrap(await store.put("users", sampleUser("u1", "dup@b.c")));
        const r = await store.put("users", sampleUser("u2", "dup@b.c"));
        expect(r.ok).toBe(false);
    });

    it("enforces the sessions → users foreign key (rejects an orphan session)", async () => {
        const r = await store.put("sessions", {
            id: "s1",
            userId: "ghost",
            createdAt: "x",
            expiresAt: 1,
            revoked: false,
        });
        expect(r.ok).toBe(false);
    });

    it("cascades: deleting a user removes its sessions", async () => {
        unwrap(await store.put("users", sampleUser("u1", "a@b.c")));
        unwrap(await store.put("sessions", {id: "s1", userId: "u1", createdAt: "x", expiresAt: 1, revoked: false}));
        expect(unwrap(await store.get("sessions", "s1"))).not.toBeNull();
        unwrap(await store.delete("users", "u1"));
        expect(unwrap(await store.get("sessions", "s1"))).toBeNull();
    });

    it("queries sessions by the typed userId column and paginates by id", async () => {
        unwrap(await store.put("users", sampleUser("u1", "a@b.c")));
        for (let i = 0; i < 5; i++) {
            unwrap(await store.put("sessions", {
                id: `s${i}`,
                userId: "u1",
                createdAt: "x",
                expiresAt: i,
                revoked: false
            }));
        }
        const seen = new Set<string>();
        let cursor: string | null = null;
        let pages = 0;
        do {
            const page = unwrap(await store.query("sessions", {where: {userId: "u1"}}, {limit: 2, after: cursor}));
            for (const s of page.items) seen.add(s.id);
            cursor = page.nextCursor;
            pages += 1;
        } while (cursor !== null && pages < 10);
        expect(seen.size).toBe(5);
        expect(pages).toBe(3);
    });

    it("uses the typed-column index for a userId lookup (not a scan)", async () => {
        const path = join(dir, "db.sqlite");
        const fileStore = createSqliteStorage({path});
        unwrap(await fileStore.put("users", sampleUser("u1", "a@b.c")));
        fileStore.close();
        const db = new Database(path, {readonly: true});
        const detail = db
            .prepare("EXPLAIN QUERY PLAN SELECT * FROM sessions WHERE userId = ? ORDER BY id ASC LIMIT ?")
            .all("u1", 50)
            .map((r) => (r as { detail: string }).detail)
            .join(" | ");
        db.close();
        expect(detail).toContain("idx_sessions_userId");
    });

    it("lists a typed collection only once it has rows; arbitrary collections still use docs", async () => {
        unwrap(await store.put("users", sampleUser("u1", "a@b.c")));
        unwrap(await store.put("posts", {id: "p1", title: "x"})); // not a typed collection → docs
        const cols = unwrap(await store.listCollections());
        expect(cols).toContain("users");
        expect(cols).toContain("posts"); // doc-store fallback still works
        expect(cols).not.toContain("sessions"); // typed but empty
    });
});

describe("AuthService over the SQLite adapter (typed users/sessions, end to end)", () => {
    it("creates a user, authenticates, validates a session, and tracks lockout in typed columns", async () => {
        const audit = await createFileAuditLog({path: join(dir, "audit.log")});
        const auth = await createAuthService({storage: store, audit, maxFailedAttempts: 3, lockoutMs: 60_000});

        const user = await auth.createUser({email: "o@b.c", password: "supersecret", roles: ["owner"]});
        expect((await auth.getUserByEmail("o@b.c"))?.id).toBe(user.id);

        const {token} = await auth.authenticate({email: "o@b.c", password: "supersecret"});
        expect(token).toBeTruthy();
        expect((await auth.validateSession(token))?.email).toBe("o@b.c");

        // The session physically lives in the normalized `sessions` table.
        const sessions = unwrap(await store.query("sessions", {}));
        expect(sessions.items).toHaveLength(1);

        // Wrong password updates the typed failedAttempts column and eventually locks.
        for (let i = 0; i < 3; i++) {
            await auth.authenticate({email: "o@b.c", password: "wrong"}).catch(() => {
            });
        }
        await expect(auth.authenticate({email: "o@b.c", password: "supersecret"})).rejects.toMatchObject({
            code: "unauthorized",
        });
    });
});

describe("ContentService over the SQLite adapter (typed content tables, end to end)", () => {
    it("models a type, authors + revises an entry, and resolves it — across the FK chain", async () => {
        const audit = await createFileAuditLog({path: join(dir, "audit.log")});
        const content = createContentService({storage: store, audit});

        const type = await content.createType(["*"], {
            name: "Page",
            slug: "page",
            fields: [{id: "title", name: "Title", type: "text", required: true}],
        });
        const created = await content.createEntry(["*"], {
            typeId: type.id,
            slug: "about",
            authorId: "author-1",
            fields: {Title: "About"}, // keyed by FieldDef.name (see buildSchema)
            blocks: [{type: "paragraph", content: "Hello"}],
        });
        // createEntry writes the entry (content_entries) AND its first revision.
        expect(created.typeId).toBe(type.id);

        // A save creates a new revision (revisions FK → content_entries).
        await content.saveEntry(["*"], created.id, {fields: {Title: "About v2"}, editorId: "author-1"});
        expect((await content.listRevisions(created.id)).length).toBeGreaterThanOrEqual(2);

        // Publish, then resolve by slug — all reading from the typed tables.
        await content.transition(["*"], created.id, "published");
        const resolved = await content.resolveBySlug("about", "en", {publicOnly: true});
        expect(resolved?.id).toBe(created.id);

        // The entry and its revisions physically live in the typed tables.
        expect(unwrap(await store.query("content_entries", {where: {status: "published"}})).items).toHaveLength(1);
        expect(unwrap(await store.query("revisions", {where: {entryId: created.id}})).items.length).toBeGreaterThanOrEqual(2);
    });
});

describe("Scheduler over the SQLite adapter (typed jobs table)", () => {
    it("persists a scheduled job as pending in the typed `jobs` table", async () => {
        const audit = await createFileAuditLog({path: join(dir, "audit.log")});
        const scheduler = createScheduler({storage: store, audit});
        scheduler.register("content.publish", async () => undefined);
        await scheduler.schedule({type: "content.publish", runAt: Date.now() + 60_000, payload: {entryId: "e1"}});

        const pending = unwrap(await store.query<{
            type: string;
            payload: { entryId: string }
        }>("jobs", {where: {status: "pending"}}));
        expect(pending.items).toHaveLength(1);
        expect(pending.items[0]?.type).toBe("content.publish");
        expect(pending.items[0]?.payload).toEqual({entryId: "e1"}); // JSON payload round-tripped
    });
});
