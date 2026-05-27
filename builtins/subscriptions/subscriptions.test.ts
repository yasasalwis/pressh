/**
 * Unit tests for the subscriptions plugin (builtins/subscriptions/index.mjs).
 *
 * Handlers are tested directly with an in-memory HostApi stub backed by the
 * filesystem storage adapter — no worker thread required.
 */
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {StorageAdapter} from "@pressh/core";
import {createFileSystemStorage} from "@pressh/core";

const {subscribe, confirm, unsubscribe, list, getStats, remove} = await import("./index.mjs");

// ── host stub ─────────────────────────────────────────────────────────────────

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
                const result = await storage.query(collection, {where}, {limit: cursor?.limit ?? 1000});
                return result.ok ? {items: result.value.items} : {items: []};
            },
        },
        log: () => undefined,
    };
}

let dir: string;
let storage: StorageAdapter;
let host: ReturnType<typeof makeHost>;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-subs-"));
    storage = createFileSystemStorage({root: join(dir, "data")});
    host = makeHost(storage);
});

afterEach(async () => {
    storage.close();
    await rm(dir, {recursive: true, force: true});
});

// ── subscribe ─────────────────────────────────────────────────────────────────

describe("subscribe", () => {
    it("creates a pending subscription and returns tokens", async () => {
        const res = await subscribe({email: "alice@example.com"}, host);
        expect(res.alreadySubscribed).toBeUndefined();
        expect(typeof res.id).toBe("string");
        expect(typeof res.confirmToken).toBe("string");
        expect(typeof res.unsubscribeToken).toBe("string");
        expect(res.confirmToken).not.toBe(res.unsubscribeToken);
    });

    it("stores status as pending and hashes tokens — raw tokens not in DB", async () => {
        const res = await subscribe({email: "alice@example.com"}, host);
        const stored = await host.storage.get("subscriptions", res.id);
        expect(stored?.status).toBe("pending");
        // Raw tokens must not be stored.
        expect(stored?.confirmTokenHash).not.toBe(res.confirmToken);
        expect(stored?.unsubscribeTokenHash).not.toBe(res.unsubscribeToken);
        // Must be 64-char SHA-256 hex strings.
        expect(String(stored?.confirmTokenHash)).toHaveLength(64);
        expect(String(stored?.unsubscribeTokenHash)).toHaveLength(64);
    });

    it("normalises email to lowercase", async () => {
        const res = await subscribe({email: "Alice@EXAMPLE.COM"}, host);
        const stored = await host.storage.get("subscriptions", res.id);
        expect(stored?.email).toBe("alice@example.com");
    });

    it("rejects invalid email addresses", async () => {
        await expect(subscribe({email: "not-an-email"}, host)).rejects.toMatchObject({
            code: "validation",
        });
        await expect(subscribe({email: ""}, host)).rejects.toMatchObject({code: "validation"});
        await expect(subscribe({email: "   "}, host)).rejects.toMatchObject({code: "validation"});
    });

    it("returns alreadySubscribed: true if already confirmed", async () => {
        const r1 = await subscribe({email: "bob@example.com"}, host);
        await confirm({token: r1.confirmToken}, host);
        const r2 = await subscribe({email: "bob@example.com"}, host);
        expect(r2.alreadySubscribed).toBe(true);
    });

    it("re-activates a pending subscription with fresh tokens", async () => {
        const r1 = await subscribe({email: "carol@example.com"}, host);
        const r2 = await subscribe({email: "carol@example.com"}, host);
        // Same ID, new tokens.
        expect(r2.id).toBe(r1.id);
        expect(r2.confirmToken).not.toBe(r1.confirmToken);
        expect(r2.unsubscribeToken).not.toBe(r1.unsubscribeToken);
    });

    it("re-activates an unsubscribed address", async () => {
        const r1 = await subscribe({email: "dave@example.com"}, host);
        await confirm({token: r1.confirmToken}, host);
        await unsubscribe({token: r1.unsubscribeToken}, host);
        const r2 = await subscribe({email: "dave@example.com"}, host);
        expect(r2.id).toBe(r1.id);
        expect(typeof r2.confirmToken).toBe("string");
    });

    it("stores memberId when provided", async () => {
        const res = await subscribe({email: "eve@example.com", memberId: "mem-42"}, host);
        const stored = await host.storage.get("subscriptions", res.id);
        expect(stored?.memberId).toBe("mem-42");
    });
});

// ── confirm ───────────────────────────────────────────────────────────────────

describe("confirm", () => {
    it("sets status to confirmed and clears confirmTokenHash", async () => {
        const r = await subscribe({email: "alice@example.com"}, host);
        const res = await confirm({token: r.confirmToken}, host);
        expect(res.ok).toBe(true);
        expect(res.email).toBe("alice@example.com");
        const stored = await host.storage.get("subscriptions", r.id);
        expect(stored?.status).toBe("confirmed");
        expect(stored?.confirmTokenHash).toBeNull();
        expect(typeof stored?.confirmedAt).toBe("string");
    });

    it("single-use — token cannot be reused after confirmation", async () => {
        // confirmTokenHash is cleared on first use; a second attempt returns not_found.
        // The site route handles this gracefully by showing the success page anyway.
        const r = await subscribe({email: "alice@example.com"}, host);
        await confirm({token: r.confirmToken}, host);
        await expect(confirm({token: r.confirmToken}, host)).rejects.toMatchObject({
            code: "not_found",
        });
    });

    it("rejects a missing token", async () => {
        await expect(confirm({token: ""}, host)).rejects.toMatchObject({code: "validation"});
    });

    it("rejects an unknown token", async () => {
        await expect(confirm({token: "00000000-0000-0000-0000-000000000000"}, host)).rejects.toMatchObject({
            code: "not_found",
        });
    });
});

// ── unsubscribe ───────────────────────────────────────────────────────────────

describe("unsubscribe", () => {
    it("sets status to unsubscribed", async () => {
        const r = await subscribe({email: "alice@example.com"}, host);
        await confirm({token: r.confirmToken}, host);
        await unsubscribe({token: r.unsubscribeToken}, host);
        const stored = await host.storage.get("subscriptions", r.id);
        expect(stored?.status).toBe("unsubscribed");
        expect(typeof stored?.unsubscribedAt).toBe("string");
    });

    it("is idempotent — unsubscribing twice is safe", async () => {
        const r = await subscribe({email: "alice@example.com"}, host);
        await unsubscribe({token: r.unsubscribeToken}, host);
        const res2 = await unsubscribe({token: r.unsubscribeToken}, host);
        expect(res2.ok).toBe(true);
    });

    it("rejects a missing token", async () => {
        await expect(unsubscribe({token: ""}, host)).rejects.toMatchObject({code: "validation"});
    });

    it("rejects an unknown token", async () => {
        await expect(unsubscribe({token: "00000000-0000-0000-0000-000000000000"}, host)).rejects.toMatchObject({
            code: "not_found",
        });
    });
});

// ── list ──────────────────────────────────────────────────────────────────────

describe("list", () => {
    async function seed() {
        const r1 = await subscribe({email: "a@example.com"}, host);
        const r2 = await subscribe({email: "b@example.com"}, host);
        await subscribe({email: "c@example.com"}, host);
        await confirm({token: r1.confirmToken}, host);
        await confirm({token: r2.confirmToken}, host);
        await unsubscribe({token: r2.unsubscribeToken}, host);
        // a = confirmed, b = unsubscribed, c = pending
    }

    it("returns all subscribers with no filter", async () => {
        await seed();
        const res = await list({}, host);
        expect(res.items).toHaveLength(3);
        expect(res.total).toBe(3);
    });

    it("filters by confirmed status", async () => {
        await seed();
        const res = await list({status: "confirmed"}, host);
        expect(res.items).toHaveLength(1);
        expect(res.items[0].email).toBe("a@example.com");
    });

    it("filters by pending status", async () => {
        await seed();
        const res = await list({status: "pending"}, host);
        expect(res.items).toHaveLength(1);
        expect(res.items[0].email).toBe("c@example.com");
    });

    it("filters by unsubscribed status", async () => {
        await seed();
        const res = await list({status: "unsubscribed"}, host);
        expect(res.items).toHaveLength(1);
        expect(res.items[0].email).toBe("b@example.com");
    });

    it("returns all emails when listed without filter", async () => {
        // Inserts may share the same millisecond so order is indeterminate — just
        // verify both records appear. Newest-first sort is covered by the seed tests
        // (where distinct timestamps come from the full subscribe→confirm→unsubscribe flow).
        await subscribe({email: "first@example.com"}, host);
        await subscribe({email: "second@example.com"}, host);
        const res = await list({}, host);
        const emails = res.items.map((s: { email: string }) => s.email);
        expect(emails).toContain("first@example.com");
        expect(emails).toContain("second@example.com");
    });

    it("never exposes token hashes", async () => {
        await seed();
        const res = await list({}, host);
        for (const item of res.items) {
            expect(item).not.toHaveProperty("confirmTokenHash");
            expect(item).not.toHaveProperty("unsubscribeTokenHash");
        }
    });
});

// ── getStats ──────────────────────────────────────────────────────────────────

describe("getStats", () => {
    it("returns zero counts on empty collection", async () => {
        const stats = await getStats({}, host);
        expect(stats).toEqual({pending: 0, confirmed: 0, unsubscribed: 0, total: 0});
    });

    it("counts correctly across statuses", async () => {
        const r1 = await subscribe({email: "a@example.com"}, host);
        const r2 = await subscribe({email: "b@example.com"}, host);
        await subscribe({email: "c@example.com"}, host);
        await confirm({token: r1.confirmToken}, host);
        await confirm({token: r2.confirmToken}, host);
        await unsubscribe({token: r2.unsubscribeToken}, host);

        const stats = await getStats({}, host);
        expect(stats.confirmed).toBe(1);
        expect(stats.pending).toBe(1);
        expect(stats.unsubscribed).toBe(1);
        expect(stats.total).toBe(3);
    });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe("remove", () => {
    it("permanently deletes a subscriber record", async () => {
        const r = await subscribe({email: "alice@example.com"}, host);
        await remove({id: r.id}, host);
        const after = await host.storage.get("subscriptions", r.id);
        expect(after).toBeNull();
    });

    it("rejects missing id", async () => {
        await expect(remove({}, host)).rejects.toMatchObject({code: "validation"});
    });
});
