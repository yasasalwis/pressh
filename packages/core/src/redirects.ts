import {randomUUID} from "node:crypto";
import {PressError} from "./errors.js";
import type {Result} from "./result.js";
import type {AuditLog} from "./audit.js";
import type {StorageAdapter, StoredDoc} from "./storage/types.js";

/**
 * Operator-defined URL redirects (exact source path → target). The Site applies
 * them on a not-found so renamed/retired pages keep working; the Studio manages
 * them (capability `redirects.manage`).
 */
const REDIRECTS = "redirects";

export type RedirectCode = 301 | 302;

interface RedirectRecord extends StoredDoc {
    from: string;
    to: string;
    code: RedirectCode;
    createdAt: string;
}

export interface Redirect {
    id: string;
    from: string;
    to: string;
    code: RedirectCode;
    createdAt: string;
}

export interface RedirectService {
    list(): Promise<Redirect[]>;

    create(input: { from: string; to: string; code?: number }): Promise<Redirect>;

    remove(id: string): Promise<void>;

    /** Resolves a request path to its redirect target, or null. */
    resolve(path: string): Promise<{ to: string; code: RedirectCode } | null>;
}

export interface RedirectServiceOptions {
    storage: StorageAdapter;
    audit: AuditLog;
    now?: () => number;
}

function must<T>(result: Result<T>): T {
    if (!result.ok) throw result.error;
    return result.value;
}

function toPublic(r: RedirectRecord): Redirect {
    return {id: r.id, from: r.from, to: r.to, code: r.code, createdAt: r.createdAt};
}

/** A redirect source must be a site-relative path (so it matches a request path). */
function normalizeFrom(from: string): string {
    const v = from.trim();
    if (!v.startsWith("/")) throw new PressError("validation", "Redirect source must start with '/'");
    // Strip a trailing slash (except root) so "/old/" and "/old" match the same path.
    return v.length > 1 && v.endsWith("/") ? v.slice(0, -1) : v;
}

/** A target may be an absolute http(s) URL or a site-relative path — never javascript: etc. */
function normalizeTo(to: string): string {
    const v = to.trim();
    if (!/^(https?:\/\/|\/)/u.test(v)) {
        throw new PressError("validation", "Redirect target must be an http(s) URL or a site-relative path");
    }
    return v;
}

export function createRedirectService(opts: RedirectServiceOptions): RedirectService {
    const now = opts.now ?? (() => Date.now());

    async function findByFrom(from: string): Promise<RedirectRecord | null> {
        const page = must(await opts.storage.query<RedirectRecord>(REDIRECTS, {where: {from}}));
        return page.items[0] ?? null;
    }

    return {
        async list() {
            const page = must(await opts.storage.query<RedirectRecord>(REDIRECTS, {}));
            return page.items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(toPublic);
        },

        async create(input) {
            const from = normalizeFrom(input.from);
            const to = normalizeTo(input.to);
            const code: RedirectCode = input.code === 302 ? 302 : 301;
            if (from === to) throw new PressError("validation", "A redirect cannot point to itself");
            if (await findByFrom(from)) {
                throw new PressError("conflict", `A redirect for ${from} already exists`);
            }
            const record: RedirectRecord = {
                id: randomUUID(),
                from,
                to,
                code,
                createdAt: new Date(now()).toISOString(),
            };
            must(await opts.storage.put(REDIRECTS, record));
            await opts.audit.append({action: "redirect.create", actorId: null, detail: {from, to, code}});
            return toPublic(record);
        },

        async remove(id) {
            const record = must(await opts.storage.get<RedirectRecord>(REDIRECTS, id));
            if (!record) return;
            must(await opts.storage.delete(REDIRECTS, id));
            await opts.audit.append({action: "redirect.delete", actorId: null, detail: {id, from: record.from}});
        },

        async resolve(path) {
            const key = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
            const record = await findByFrom(key);
            return record ? {to: record.to, code: record.code} : null;
        },
    };
}
