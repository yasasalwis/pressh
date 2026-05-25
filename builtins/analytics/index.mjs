// Privacy Analytics — cookieless, server-side page-view counts. The Site calls
// `collect` on render (no client JS, no cookies, no third parties); only an
// aggregate per-day, per-path counter is stored in `analytics_daily`. No IP, no
// user agent, no fingerprint is ever persisted, so there is nothing to leak.

const COLLECTION = "analytics_daily";
const MAX_PATHS_PER_DAY = 2000;
const MAX_PATH_LEN = 300;

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

// Counts are read-modify-write on a shared daily doc. Serialising through one
// in-worker promise chain prevents concurrent page views from clobbering each
// other's increment (there is a single analytics worker on the Site process).
let chain = Promise.resolve();

/** @param {{ path?: string }} args @param {import('@pressh/sdk').HostApi} host */
async function increment(args, host) {
  const date = today();
  const path = (String(args?.path ?? "/").slice(0, MAX_PATH_LEN)) || "/";
  const existing = await host.storage.get(COLLECTION, date);
  const doc =
    existing && typeof existing === "object" ? existing : { id: date, total: 0, paths: {} };
  if (!doc.paths || typeof doc.paths !== "object") doc.paths = {};
  doc.total = Number(doc.total || 0) + 1;
  // Cap distinct paths so a crawler hitting unique URLs can't grow the doc unbounded.
  if (doc.paths[path] !== undefined || Object.keys(doc.paths).length < MAX_PATHS_PER_DAY) {
    doc.paths[path] = Number(doc.paths[path] || 0) + 1;
  }
  await host.storage.put(COLLECTION, doc);
}

/** @param {{ path?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function collect(args, host) {
  const run = chain.then(() => increment(args, host));
  chain = run.catch(() => undefined); // a failed write must not break the chain
  return run.then(() => ({ ok: true }));
}

/** @param {{ days?: number }} args @param {import('@pressh/sdk').HostApi} host */
export async function summary(args, host) {
  const days = Math.min(Math.max(Number(args?.days) || 30, 1), 365);
  const page = await host.storage.query(COLLECTION, undefined, { limit: 366 });
  const recent = page.items
    .slice()
    .sort((a, b) => String(b.id).localeCompare(String(a.id)))
    .slice(0, days);

  const byDay = recent.map((d) => ({ date: d.id, total: Number(d.total || 0) }));
  const pathTotals = {};
  let total = 0;
  for (const d of recent) {
    total += Number(d.total || 0);
    for (const [p, count] of Object.entries(d.paths || {})) {
      pathTotals[p] = (pathTotals[p] || 0) + Number(count || 0);
    }
  }
  const topPaths = Object.entries(pathTotals)
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { total, days: byDay, topPaths };
}
