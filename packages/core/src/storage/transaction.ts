import {PressError} from "../errors.js";
import {err, ok} from "../result.js";
import type {Result} from "../result.js";
import type {StorageAdapter, StoredDoc} from "./types.js";

function toPressError(e: unknown): PressError {
    if (e instanceof PressError) return e;
    return new PressError("internal", e instanceof Error ? e.message : "Storage error");
}

// Collection/id segments are constrained to a charset that excludes spaces,
// so a space is a safe composite-key separator.
const SEP = " ";

/**
 * A backend-agnostic transaction built on the adapter's own get/put/delete.
 * It journals each touched record's prior value before its first mutation and
 * restores them all if `fn` throws, giving all-or-nothing atomicity for the
 * transaction's OWN writes (not isolation from concurrent writers).
 *
 * Used by adapters without a cheap native transaction (filesystem, MongoDB
 * standalone, and the SQL adapters' compensating path). SQLite uses a real
 * BEGIN/COMMIT/ROLLBACK instead.
 */
export async function journaledTransaction<T>(
    self: StorageAdapter,
    fn: (tx: StorageAdapter) => Promise<T>,
): Promise<Result<T>> {
    const journal = new Map<string, StoredDoc | null>();
    const capture = async (collection: string, id: string): Promise<void> => {
        const k = `${collection}${SEP}${id}`;
        if (journal.has(k)) return;
        const prior = await self.get(collection, id);
        journal.set(k, prior.ok ? prior.value : null);
    };
    const tx: StorageAdapter = {
        get: (c, id) => self.get(c, id),
        query: (c, f, p) => self.query(c, f, p),
        listCollections: () => self.listCollections(),
        rebuildIndex: () => self.rebuildIndex(),
        close: () => undefined,
        // A nested transaction shares this journal; a throw propagates to the outer
        // handler for a single unified rollback.
        transaction: async (f) => ok(await f(tx)),
        put: async (c, doc) => {
            await capture(c, doc.id);
            return self.put(c, doc);
        },
        delete: async (c, id) => {
            await capture(c, id);
            return self.delete(c, id);
        },
    };
    try {
        return ok(await fn(tx));
    } catch (e) {
        for (const [k, prior] of journal) {
            const sep = k.indexOf(SEP);
            const collection = k.slice(0, sep);
            const id = k.slice(sep + 1);
            if (prior === null) await self.delete(collection, id).catch(() => undefined);
            else await self.put(collection, prior).catch(() => undefined);
        }
        return err(toPressError(e));
    }
}
