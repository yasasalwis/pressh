// Comments — site-member discussion threads attached to content entries.
//
// Member identity is injected by the Site's plugin dispatch layer (app.ts)
// AFTER validating the session cookie. The `_memberId` / `_memberDisplayName`
// fields in args are server-authoritative; clients cannot supply them directly
// (the dispatch strips any client-supplied `_member*` values first).
//
// Moderation model: new comments land in "pending" until an operator approves
// them through the Studio panel. The public `list` endpoint only returns
// "approved" comments.

import {randomUUID} from "node:crypto";

const COLLECTION = "comments";
const MAX_BODY = 5000;
const STATUSES = new Set(["pending", "approved", "rejected"]);
const PAGE = 500;

// ── public endpoints ──────────────────────────────────────────────────────────

/**
 * Submit a comment on a content entry. Requires a validated member session —
 * the dispatch layer injects `_memberId` and `_memberDisplayName` from the
 * verified cookie before calling this handler.
 *
 * @param {Record<string, unknown>} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function submit(args, host) {
    const memberId = typeof args._memberId === "string" ? args._memberId.trim() : "";
    if (!memberId) {
        throw Object.assign(new Error("You must be logged in to comment"), {code: "unauthorized"});
    }

    const entrySlug = typeof args.entrySlug === "string" ? args.entrySlug.trim().slice(0, 500) : "";
    if (!entrySlug) {
        throw Object.assign(new Error("entrySlug is required"), {code: "validation"});
    }

    const body = typeof args.body === "string" ? args.body.trim().slice(0, MAX_BODY) : "";
    if (body.length < 2) {
        throw Object.assign(new Error("Comment body must be at least 2 characters"), {code: "validation"});
    }

    const memberDisplayName =
        typeof args._memberDisplayName === "string" ? args._memberDisplayName.slice(0, 200) : "Member";

    const doc = {
        id: randomUUID(),
        entrySlug,
        memberId,
        memberDisplayName,
        body,
        status: "pending",
        createdAt: new Date().toISOString(),
    };

    await host.storage.put(COLLECTION, doc);
    return {ok: true, id: doc.id, status: "pending"};
}

/**
 * Returns approved comments for a given content entry slug.
 * Public endpoint — no auth required.
 *
 * @param {{ entrySlug?: string; limit?: number }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function list(args, host) {
    const entrySlug = typeof args.entrySlug === "string" ? args.entrySlug.trim() : "";
    const limit = Math.min(Math.max(1, Number(args.limit) || 50), 200);

    const page = await host.storage.query(COLLECTION, {status: "approved"}, {limit: PAGE});
    let items = (page.items ?? []).filter((c) => !entrySlug || c.entrySlug === entrySlug);

    // Sort oldest-first so threads read top-to-bottom.
    items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    items = items.slice(0, limit);

    return {
        items: items.map((c) => ({
            id: c.id,
            memberDisplayName: c.memberDisplayName,
            body: c.body,
            createdAt: c.createdAt,
        })),
    };
}

// ── panel actions (Studio only) ───────────────────────────────────────────────

/**
 * List all comments for the moderation panel.
 *
 * @param {{ status?: string; entrySlug?: string }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function listAll(args, host) {
    const filterStatus = typeof args.status === "string" && STATUSES.has(args.status) ? args.status : null;
    const filterSlug = typeof args.entrySlug === "string" ? args.entrySlug.trim() : "";

    const where = {};
    if (filterStatus) where.status = filterStatus;
    const page = await host.storage.query(COLLECTION, where, {limit: PAGE});

    let items = page.items ?? [];
    if (filterSlug) items = items.filter((c) => c.entrySlug === filterSlug);
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return {items, total: items.length};
}

/**
 * Approve a pending comment.
 * @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host
 */
export async function approve(args, host) {
    const id = String(args?.id ?? "").trim();
    if (!id) throw Object.assign(new Error("id is required"), {code: "validation"});
    const result = await host.storage.get(COLLECTION, id);
    if (!result?.id) throw Object.assign(new Error("Comment not found"), {code: "not_found"});
    await host.storage.put(COLLECTION, {...result, status: "approved"});
    return {ok: true};
}

/**
 * Reject a comment.
 * @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host
 */
export async function reject(args, host) {
    const id = String(args?.id ?? "").trim();
    if (!id) throw Object.assign(new Error("id is required"), {code: "validation"});
    const result = await host.storage.get(COLLECTION, id);
    if (!result?.id) throw Object.assign(new Error("Comment not found"), {code: "not_found"});
    await host.storage.put(COLLECTION, {...result, status: "rejected"});
    return {ok: true};
}

/**
 * Permanently delete a comment.
 * @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host
 */
export async function remove(args, host) {
    const id = String(args?.id ?? "").trim();
    if (!id) throw Object.assign(new Error("id is required"), {code: "validation"});
    await host.storage.delete(COLLECTION, id);
    return {ok: true};
}
