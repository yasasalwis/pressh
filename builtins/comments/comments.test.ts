/**
 * Unit tests for the comments plugin handlers (builtins/comments/index.mjs).
 *
 * Handlers are plain async functions — tested directly against an in-memory
 * HostApi stub without spinning up a worker thread.
 */
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {StorageAdapter} from "@pressh/core";
import {createFileSystemStorage} from "@pressh/core";

// Dynamic import so vitest resolves the .mjs via its ESM pipeline.
const {submit, list, listAll, approve, reject, remove} = await import("./index.mjs");

// ── in-memory mock HostApi ────────────────────────────────────────────────────

function makeHost(storage: StorageAdapter) {
    return {
        storage: {
            async get(collection: string, id: string) {
                const r = await storage.get(collection, id);
                return r.ok ? r.value : null;
            },
            async put(collection: string, doc: Record<string, unknown>) {
                await storage.put(collection, doc as never);
            },
            async delete(collection: string, id: string) {
                await storage.delete(collection, id);
            },
            async query(
                collection: string,
                where?: Record<string, unknown>,
                cursor?: { limit?: number },
            ) {
                const result = await storage.query(collection, {where}, {limit: cursor?.limit ?? 500});
                return result.ok ? {items: result.value.items} : {items: []};
            },
        },
        log: () => undefined,
    };
}

const MEMBER_ARGS = {
    _memberId: "member-123",
    _memberDisplayName: "Alice",
};

let dir: string;
let storage: StorageAdapter;
let host: ReturnType<typeof makeHost>;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-comments-"));
    storage = createFileSystemStorage({root: join(dir, "data")});
    host = makeHost(storage);
});

afterEach(async () => {
    storage.close();
    await rm(dir, {recursive: true, force: true});
});

// ── submit ────────────────────────────────────────────────────────────────────

describe("submit", () => {
    it("creates a pending comment for an authenticated member", async () => {
        const res = await submit({...MEMBER_ARGS, entrySlug: "my-post", body: "Great article!"}, host);
        expect(res.ok).toBe(true);
        expect(res.status).toBe("pending");
        expect(typeof res.id).toBe("string");
    });

    it("rejects unauthenticated submissions (no _memberId)", async () => {
        await expect(submit({entrySlug: "my-post", body: "Spam"}, host)).rejects.toMatchObject({
            code: "unauthorized",
        });
    });

    it("rejects an empty _memberId", async () => {
        await expect(
            submit({_memberId: "  ", entrySlug: "my-post", body: "Spam"}, host),
        ).rejects.toMatchObject({code: "unauthorized"});
    });

    it("rejects missing entrySlug", async () => {
        await expect(submit({...MEMBER_ARGS, body: "Hello"}, host)).rejects.toMatchObject({
            code: "validation",
        });
    });

    it("rejects a body shorter than 2 characters", async () => {
        await expect(
            submit({...MEMBER_ARGS, entrySlug: "my-post", body: "x"}, host),
        ).rejects.toMatchObject({code: "validation"});
    });

    it("truncates body to 5000 characters", async () => {
        const longBody = "a".repeat(10000);
        const res = await submit({...MEMBER_ARGS, entrySlug: "my-post", body: longBody}, host);
        expect(res.ok).toBe(true);
        // Verify stored body is capped.
        const stored = await host.storage.get("comments", res.id);
        expect(String(stored?.body ?? "").length).toBe(5000);
    });

    it("ignores client-supplied _memberId if called without one (no injection)", async () => {
        // The dispatch layer strips _member* from client args before calling the handler.
        // A missing _memberId means the user is not authenticated.
        await expect(
            submit({entrySlug: "slug", body: "Hello world"}, host),
        ).rejects.toMatchObject({code: "unauthorized"});
    });
});

// ── list (public) ─────────────────────────────────────────────────────────────

describe("list", () => {
    async function seed() {
        await submit({...MEMBER_ARGS, entrySlug: "post-a", body: "First comment"}, host);
        await submit({...MEMBER_ARGS, entrySlug: "post-a", body: "Second comment"}, host);
        await submit({...MEMBER_ARGS, entrySlug: "post-b", body: "Other post comment"}, host);
        // Approve the first two.
        const all = await listAll({}, host);
        for (const c of all.items.filter((x: { entrySlug: string }) => x.entrySlug === "post-a")) {
            await approve({id: c.id}, host);
        }
    }

    it("returns only approved comments", async () => {
        await seed();
        const res = await list({entrySlug: "post-a"}, host);
        expect(res.items).toHaveLength(2);
        expect(res.items.every((c: { status?: string }) => !c.status)).toBe(true); // status not exposed
    });

    it("filters by entrySlug", async () => {
        await seed();
        const res = await list({entrySlug: "post-b"}, host);
        expect(res.items).toHaveLength(0); // post-b comment is still pending
    });

    it("returns all approved comments when no slug filter", async () => {
        await seed();
        const res = await list({}, host);
        expect(res.items).toHaveLength(2); // only post-a comments were approved
    });

    it("does not expose memberId or status in the public response", async () => {
        await seed();
        const res = await list({entrySlug: "post-a"}, host);
        for (const item of res.items) {
            expect(item).not.toHaveProperty("memberId");
            expect(item).not.toHaveProperty("status");
        }
    });

    it("returns both approved comments for the slug", async () => {
        await seed();
        const res = await list({entrySlug: "post-a"}, host);
        const bodies = res.items.map((c: { body: string }) => c.body);
        expect(bodies).toContain("First comment");
        expect(bodies).toContain("Second comment");
    });
});

// ── listAll (panel) ───────────────────────────────────────────────────────────

describe("listAll", () => {
    it("returns all comments with no filter", async () => {
        await submit({...MEMBER_ARGS, entrySlug: "s1", body: "Hello world!"}, host);
        await submit({...MEMBER_ARGS, entrySlug: "s2", body: "Another comment"}, host);
        const res = await listAll({}, host);
        expect(res.items).toHaveLength(2);
    });

    it("filters by status", async () => {
        const r1 = await submit({...MEMBER_ARGS, entrySlug: "s1", body: "Pending comment"}, host);
        await approve({id: r1.id}, host);
        await submit({...MEMBER_ARGS, entrySlug: "s1", body: "Another pending"}, host);

        const pending = await listAll({status: "pending"}, host);
        expect(pending.items).toHaveLength(1);

        const approved = await listAll({status: "approved"}, host);
        expect(approved.items).toHaveLength(1);
    });

    it("sorts newest-first", async () => {
        await submit({...MEMBER_ARGS, entrySlug: "s1", body: "First"}, host);
        await submit({...MEMBER_ARGS, entrySlug: "s1", body: "Second"}, host);
        const res = await listAll({}, host);
        expect(res.items[0].body).toBe("Second");
    });
});

// ── approve / reject ──────────────────────────────────────────────────────────

describe("approve", () => {
    it("sets status to approved", async () => {
        const r = await submit({...MEMBER_ARGS, entrySlug: "s", body: "Hello world"}, host);
        await approve({id: r.id}, host);
        const stored = await host.storage.get("comments", r.id);
        expect(stored?.status).toBe("approved");
    });

    it("rejects missing id", async () => {
        await expect(approve({}, host)).rejects.toMatchObject({code: "validation"});
    });

    it("rejects unknown id", async () => {
        await expect(approve({id: "ghost"}, host)).rejects.toMatchObject({code: "not_found"});
    });
});

describe("reject", () => {
    it("sets status to rejected", async () => {
        const r = await submit({...MEMBER_ARGS, entrySlug: "s", body: "Hello world"}, host);
        await reject({id: r.id}, host);
        const stored = await host.storage.get("comments", r.id);
        expect(stored?.status).toBe("rejected");
    });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe("remove", () => {
    it("deletes the comment", async () => {
        const r = await submit({...MEMBER_ARGS, entrySlug: "s", body: "Hello world"}, host);
        await remove({id: r.id}, host);
        const after = await host.storage.get("comments", r.id);
        expect(after).toBeNull();
    });

    it("rejects missing id", async () => {
        await expect(remove({}, host)).rejects.toMatchObject({code: "validation"});
    });
});
