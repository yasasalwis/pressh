// Data Manager — a read-only data browser + JSON export. It can list and read
// collections through the capability-gated host API (granted `storage.read:*`),
// but there is NO raw-query / SQL surface (security baseline #14): a compromised
// admin session can browse and export, never mutate data or run arbitrary SQL.
// Auth-critical collections (users/sessions/invites) are blocked host-side.

const MAX_PAGE = 50;
const EXPORT_CAP = 5000;
const EXPORT_PAGE = 200;

/** @param {unknown} _args @param {import('@pressh/sdk').HostApi} host */
export async function listCollections(_args, host) {
  return { collections: await host.storage.list() };
}

/** @param {{ collection?: string, limit?: number, after?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function queryCollection(args, host) {
  const collection = String(args?.collection ?? "").trim();
  if (!collection) throw new Error("A collection name is required");
  const limit = Math.min(Math.max(Number(args?.limit) || MAX_PAGE, 1), MAX_PAGE);
  const page = { limit };
  if (typeof args?.after === "string" && args.after) page.after = args.after;
  const result = await host.storage.query(collection, undefined, page);
  return { items: result.items, nextCursor: result.nextCursor };
}

/** @param {unknown} _args @param {import('@pressh/sdk').HostApi} host */
export async function exportAll(_args, host) {
  const names = await host.storage.list();
  const collections = {};
  let total = 0;
  for (const name of names) {
    const docs = [];
    let after = null;
    for (;;) {
      // Reserved/unreadable collections reject — skip them rather than fail the export.
      const page = await host.storage
        .query(name, undefined, after ? { limit: EXPORT_PAGE, after } : { limit: EXPORT_PAGE })
        .catch(() => null);
      if (!page) break;
      docs.push(...page.items);
      total += page.items.length;
      if (!page.nextCursor || total >= EXPORT_CAP) break;
      after = page.nextCursor;
    }
    collections[name] = docs;
  }
  return { exportedAt: new Date().toISOString(), truncated: total >= EXPORT_CAP, collections };
}
