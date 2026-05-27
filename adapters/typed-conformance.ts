import {afterEach, beforeEach, describe, expect, it} from "vitest";
import type {Result, StorageAdapter} from "@pressh/core";

/**
 * Shared behavioral suite for the NORMALIZED typed tables (users, sessions).
 * Every SQL adapter (SQLite locally; Postgres/MySQL in CI) runs the SAME
 * assertions through the StorageAdapter interface — lossless round-trip plus the
 * integrity guarantees that distinguish typed tables from the doc store
 * (UNIQUE, FOREIGN KEY, ON DELETE CASCADE). Pure behavioral checks, so it is
 * backend-agnostic (no physical-layout inspection).
 */
function unwrap<T>(r: Result<T>): T {
    if (!r.ok) throw r.error;
    return r.value;
}

const user = (id: string, email: string) => ({
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

const session = (id: string, userId: string) => ({
    id,
    userId,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: 1_900_000_000_000,
    revoked: false,
});

export function typedTableConformanceTests(
    label: string,
    make: () => Promise<StorageAdapter> | StorageAdapter,
    dispose: (adapter: StorageAdapter) => Promise<void> | void,
): void {
    describe(`Typed-table conformance: ${label}`, () => {
        let store: StorageAdapter;

        beforeEach(async () => {
            store = await make();
            // Start clean — delete children before parents so FKs don't block it.
            for (const coll of [
                "revisions",
                "content_entries",
                "content_types",
                "sessions",
                "users",
                "invites",
                "jobs",
                "plugin_state",
                "media",
                "consent_records",
                "gdpr_tombstones",
            ]) {
                const page = await store.query(coll, {}, {limit: 500});
                if (page.ok) for (const item of page.value.items) await store.delete(coll, item.id);
            }
        });
        afterEach(async () => {
            await dispose(store);
        });

        it("losslessly round-trips a user (arrays, booleans, null, and unmapped extras)", async () => {
            const doc = {...user("u1", "a@b.c"), customFlag: true, nested: {a: 1}};
            unwrap(await store.put("users", doc));
            expect(unwrap(await store.get("users", "u1"))).toEqual(doc);
        });

        it("enforces the UNIQUE email constraint (rejects a second user with the same email)", async () => {
            unwrap(await store.put("users", user("u1", "dup@b.c")));
            const r = await store.put("users", user("u2", "dup@b.c"));
            expect(r.ok).toBe(false);
        });

        it("upserts an existing user by id without disturbing its sessions", async () => {
            unwrap(await store.put("users", user("u1", "a@b.c")));
            unwrap(await store.put("sessions", session("s1", "u1")));
            // Re-put the user (same id, changed field) — must NOT cascade-delete the session.
            unwrap(await store.put("users", {...user("u1", "a@b.c"), status: "disabled"}));
            expect(unwrap(await store.get<{ status: string }>("users", "u1"))?.status).toBe("disabled");
            expect(unwrap(await store.get("sessions", "s1"))).not.toBeNull();
        });

        it("enforces the sessions → users foreign key (rejects an orphan session)", async () => {
            const r = await store.put("sessions", session("s1", "ghost"));
            expect(r.ok).toBe(false);
        });

        it("cascades: deleting a user removes its sessions", async () => {
            unwrap(await store.put("users", user("u1", "a@b.c")));
            unwrap(await store.put("sessions", session("s1", "u1")));
            expect(unwrap(await store.get("sessions", "s1"))).not.toBeNull();
            unwrap(await store.delete("users", "u1"));
            expect(unwrap(await store.get("sessions", "s1"))).toBeNull();
        });

        it("queries by the typed columns (email, userId)", async () => {
            unwrap(await store.put("users", user("u1", "a@b.c")));
            unwrap(await store.put("users", user("u2", "x@y.z")));
            unwrap(await store.put("sessions", session("s1", "u1")));
            unwrap(await store.put("sessions", session("s2", "u1")));
            expect(unwrap(await store.query("users", {where: {email: "x@y.z"}})).items.map((u) => u.id)).toEqual(["u2"]);
            expect(unwrap(await store.query("sessions", {where: {userId: "u1"}})).items).toHaveLength(2);
        });

        // ── content FK chain: content_types ← content_entries ← revisions ──────────
        const type = (id: string, slug: string) => ({
            id,
            name: "Page",
            slug,
            fields: [{id: "title", name: "Title", type: "text", required: true}],
            createdAt: "2026-01-01T00:00:00.000Z",
        });
        const entry = (id: string, typeId: string, slug: string) => ({
            id,
            typeId,
            slug,
            locale: "en",
            status: "published",
            authorId: "u1",
            currentRevision: 1,
            publishedAt: "2026-01-02T00:00:00.000Z",
            scheduledFor: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
        });
        const revision = (id: string, entryId: string) => ({
            id,
            entryId,
            version: 1,
            fields: {title: "Hello"},
            blocks: [{type: "paragraph", content: "Hi"}],
            editorId: "u1",
            createdAt: "2026-01-02T00:00:00.000Z",
        });

        it("round-trips content entries and revisions incl. JSON fields/blocks (null preserved, optional omitted)", async () => {
            const t = type("t1", "page");
            const e = entry("e1", "t1", "about"); // no `system` key → must stay absent
            const r = revision("e1.1", "e1");
            unwrap(await store.put("content_types", t));
            unwrap(await store.put("content_entries", e));
            unwrap(await store.put("revisions", r));
            expect(unwrap(await store.get("content_types", "t1"))).toEqual(t);
            const gotEntry = unwrap(await store.get<Record<string, unknown>>("content_entries", "e1"));
            expect(gotEntry).toEqual(e);
            expect("system" in (gotEntry as object)).toBe(false); // optional + absent ⇒ omitted, not null
            expect(gotEntry?.["scheduledFor"]).toBeNull(); // meaningful null preserved
            expect(unwrap(await store.get("revisions", "e1.1"))).toEqual(r);
        });

        it("enforces content_entries → content_types FK (rejects an entry for a missing type)", async () => {
            const r = await store.put("content_entries", entry("e1", "ghost-type", "about"));
            expect(r.ok).toBe(false);
        });

        it("enforces revisions → content_entries FK and cascades on entry delete", async () => {
            unwrap(await store.put("content_types", type("t1", "page")));
            unwrap(await store.put("content_entries", entry("e1", "t1", "about")));
            // Orphan revision rejected.
            expect((await store.put("revisions", revision("x.1", "ghost-entry"))).ok).toBe(false);
            // Valid revision, then cascade.
            unwrap(await store.put("revisions", revision("e1.1", "e1")));
            unwrap(await store.delete("content_entries", "e1"));
            expect(unwrap(await store.get("revisions", "e1.1"))).toBeNull();
        });

        it("refuses to delete a content type that still has entries (RESTRICT)", async () => {
            unwrap(await store.put("content_types", type("t1", "page")));
            unwrap(await store.put("content_entries", entry("e1", "t1", "about")));
            const r = await store.delete("content_types", "t1");
            expect(r.ok).toBe(false);
        });

        it("round-trips an invite (roles array, nullable invitedBy/consumedAt)", async () => {
            const inv = {
                id: "i1",
                email: "new@b.c",
                roles: ["author"],
                tokenHash: "abc123",
                invitedBy: null,
                expiresAt: 1_900_000_000_000,
                consumedAt: null,
                createdAt: "2026-01-01T00:00:00.000Z",
            };
            unwrap(await store.put("invites", inv));
            expect(unwrap(await store.get("invites", "i1"))).toEqual(inv);
            expect(unwrap(await store.query("invites", {where: {tokenHash: "abc123"}})).items.map((i) => i.id)).toEqual([
                "i1",
            ]);
        });

        // ── standalone host-owned tables (jobs, plugin_state, consent, settings) ────
        it("round-trips a job (JSON payload) and queries by status", async () => {
            const job = {
                id: "j1",
                type: "content.publish",
                runAt: 1_900_000_000_000,
                payload: {entryId: "e1", nested: [1, 2, 3]},
                status: "pending",
                attempts: 0,
                createdAt: "2026-01-01T00:00:00.000Z",
            };
            unwrap(await store.put("jobs", job));
            unwrap(await store.put("jobs", {...job, id: "j2", status: "done"}));
            expect(unwrap(await store.get("jobs", "j1"))).toEqual(job);
            expect(unwrap(await store.query("jobs", {where: {status: "pending"}})).items.map((j) => j.id)).toEqual(["j1"]);
        });

        it("round-trips plugin_state (boolean) keyed by plugin name", async () => {
            unwrap(await store.put("plugin_state", {id: "inventory", enabled: true}));
            expect(unwrap(await store.get("plugin_state", "inventory"))).toEqual({id: "inventory", enabled: true});
        });

        it("round-trips a consent record and queries by subjectRef", async () => {
            const c = {
                id: "c1",
                subjectRef: "a@b.c",
                scope: "marketing",
                granted: true,
                at: "2026-01-01T00:00:00.000Z"
            };
            unwrap(await store.put("consent_records", c));
            expect(unwrap(await store.get("consent_records", "c1"))).toEqual(c);
            expect(unwrap(await store.query("consent_records", {where: {subjectRef: "a@b.c"}})).items).toHaveLength(1);
        });

        it("round-trips a GDPR tombstone", async () => {
            const t = {id: "tomb1", subject: "deadbeef-hash", erasedCount: 3, erasedAt: "2026-01-01T00:00:00.000Z"};
            unwrap(await store.put("gdpr_tombstones", t));
            expect(unwrap(await store.get("gdpr_tombstones", "tomb1"))).toEqual(t);
        });
    });
}
