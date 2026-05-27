// Subscriptions — double opt-in email newsletter with unsubscribe support.
//
// Token scheme:
//   - A raw UUID token is generated server-side and embedded in the confirm/
//     unsubscribe URL.
//   - Only the SHA-256 hex hash is stored in the DB so a storage leak never
//     exposes live tokens.
//   - The confirmToken is single-use; it is cleared (set to null) once the
//     subscriber confirms.
//   - The unsubscribeToken is permanent and present in every outbound email.
//
// Site routes (not public plugin dispatch) call subscribe(), confirm(), and
// unsubscribe() because those handlers return raw tokens the route needs to
// embed in email URLs before sending.

import {createHash, randomUUID} from "node:crypto";

const COLLECTION = "subscriptions";
const PAGE = 1000;

function hashToken(raw) {
    return createHash("sha256").update(raw).digest("hex");
}

// ── subscribe ─────────────────────────────────────────────────────────────────

/**
 * Create or re-activate a subscription.
 *
 * Returns one of:
 *   { alreadySubscribed: true }                    — already confirmed, nothing to do
 *   { id, confirmToken, unsubscribeToken }          — new or re-activated; caller sends email
 *
 * @param {{ email: string; memberId?: string }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function subscribe(args, host) {
    const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw Object.assign(new Error("A valid email address is required"), {code: "validation"});
    }
    const memberId = typeof args.memberId === "string" ? args.memberId.trim() || null : null;

    // Look for an existing subscription with this email.
    const page = await host.storage.query(COLLECTION, {email}, {limit: 5});
    const existing = (page.items ?? []).find((s) => s.email === email) ?? null;

    if (existing) {
        if (existing.status === "confirmed") {
            return {alreadySubscribed: true};
        }

        // Pending or unsubscribed — issue fresh tokens and re-activate.
        const confirmToken = randomUUID();
        const unsubscribeToken = randomUUID();
        await host.storage.put(COLLECTION, {
            ...existing,
            memberId: memberId ?? existing.memberId ?? null,
            status: "pending",
            confirmTokenHash: hashToken(confirmToken),
            unsubscribeTokenHash: hashToken(unsubscribeToken),
            updatedAt: new Date().toISOString(),
        });
        return {id: existing.id, confirmToken, unsubscribeToken};
    }

    // Brand-new subscriber.
    const confirmToken = randomUUID();
    const unsubscribeToken = randomUUID();
    const doc = {
        id: randomUUID(),
        email,
        memberId,
        status: "pending",
        confirmTokenHash: hashToken(confirmToken),
        unsubscribeTokenHash: hashToken(unsubscribeToken),
        confirmedAt: null,
        unsubscribedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    await host.storage.put(COLLECTION, doc);
    return {id: doc.id, confirmToken, unsubscribeToken};
}

// ── confirm ───────────────────────────────────────────────────────────────────

/**
 * Confirm a subscription using the raw token from the email link.
 * Clears confirmTokenHash on success (single-use).
 *
 * @param {{ token: string }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function confirm(args, host) {
    const raw = typeof args.token === "string" ? args.token.trim() : "";
    if (!raw) {
        throw Object.assign(new Error("token is required"), {code: "validation"});
    }
    const hash = hashToken(raw);

    const page = await host.storage.query(COLLECTION, {confirmTokenHash: hash}, {limit: 2});
    const sub = (page.items ?? []).find((s) => s.confirmTokenHash === hash) ?? null;
    if (!sub) {
        throw Object.assign(new Error("Invalid or expired confirmation token"), {code: "not_found"});
    }
    if (sub.status === "confirmed") {
        // Idempotent — already confirmed.
        return {ok: true, email: sub.email};
    }

    await host.storage.put(COLLECTION, {
        ...sub,
        status: "confirmed",
        confirmTokenHash: null, // single-use
        confirmedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
    return {ok: true, email: sub.email};
}

// ── unsubscribe ───────────────────────────────────────────────────────────────

/**
 * Unsubscribe using the permanent token embedded in every outbound email.
 *
 * @param {{ token: string }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function unsubscribe(args, host) {
    const raw = typeof args.token === "string" ? args.token.trim() : "";
    if (!raw) {
        throw Object.assign(new Error("token is required"), {code: "validation"});
    }
    const hash = hashToken(raw);

    const page = await host.storage.query(COLLECTION, {unsubscribeTokenHash: hash}, {limit: 2});
    const sub = (page.items ?? []).find((s) => s.unsubscribeTokenHash === hash) ?? null;
    if (!sub) {
        throw Object.assign(new Error("Invalid unsubscribe token"), {code: "not_found"});
    }
    if (sub.status === "unsubscribed") {
        return {ok: true}; // already unsubscribed — idempotent
    }

    await host.storage.put(COLLECTION, {
        ...sub,
        status: "unsubscribed",
        unsubscribedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
    return {ok: true};
}

// ── panel actions ─────────────────────────────────────────────────────────────

/**
 * List subscribers for the Studio panel, sorted newest-first.
 *
 * @param {{ status?: string; limit?: number }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function list(args, host) {
    const VALID_STATUSES = new Set(["pending", "confirmed", "unsubscribed"]);
    const filterStatus =
        typeof args.status === "string" && VALID_STATUSES.has(args.status) ? args.status : null;
    const limit = Math.min(Math.max(1, Number(args.limit) || 200), 1000);

    const where = filterStatus ? {status: filterStatus} : {};
    const page = await host.storage.query(COLLECTION, where, {limit: PAGE});
    let items = page.items ?? [];

    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    items = items.slice(0, limit);

    // Never expose token hashes to the panel.
    return {
        items: items.map((s) => ({
            id: s.id,
            email: s.email,
            memberId: s.memberId ?? null,
            status: s.status,
            confirmedAt: s.confirmedAt ?? null,
            unsubscribedAt: s.unsubscribedAt ?? null,
            createdAt: s.createdAt,
        })),
        total: items.length,
    };
}

/**
 * Aggregate counts by status.
 * @param {Record<string, unknown>} _args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function getStats(_args, host) {
    const page = await host.storage.query(COLLECTION, {}, {limit: PAGE});
    const all = page.items ?? [];
    const counts = {pending: 0, confirmed: 0, unsubscribed: 0, total: all.length};
    for (const s of all) {
        if (s.status === "pending") counts.pending++;
        else if (s.status === "confirmed") counts.confirmed++;
        else if (s.status === "unsubscribed") counts.unsubscribed++;
    }
    return counts;
}

/**
 * Permanently delete a subscriber record (GDPR erasure).
 * @param {{ id?: string }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function remove(args, host) {
    const id = String(args?.id ?? "").trim();
    if (!id) throw Object.assign(new Error("id is required"), {code: "validation"});
    await host.storage.delete(COLLECTION, id);
    return {ok: true};
}
