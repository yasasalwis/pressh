// Inventory — an advanced product catalog + e-commerce backend. All data lives
// in plugin-owned, capability-gated collections (never the engine's content
// store): products with variants/options, categories, an audited stock ledger,
// and store settings. Orders / returns / payments are layered on in a later
// phase against the same isolated collections.
//
// Every handler is a plain async (args, host) function so it can be unit-tested
// directly against an in-memory HostApi and run unchanged inside the worker.

import {randomUUID} from "node:crypto";

// ── collections ──────────────────────────────────────────────────────────────
const ITEMS = "inventory_items";
const CATEGORIES = "inventory_categories";
const MOVEMENTS = "inventory_stock_movements";
const SETTINGS = "inventory_settings";
const ORDERS = "inventory_orders";
const RETURNS = "inventory_returns";
const PAYMENTS = "inventory_payments";
const COUNTERS = "inventory_counters";

const ORDER_START = 1000;
const RETURN_START = 1;
const ORDER_STATUSES = new Set(["pending", "paid", "fulfilled", "cancelled", "refunded"]);
const RETURN_STATUSES = new Set(["requested", "approved", "received", "refunded", "rejected"]);
const PAYMENT_METHODS = new Set(["card", "cash", "bank", "manual", "other"]);

const PAGE = 1000; // upper bound when reading a whole collection for in-JS work
const MOVEMENTS_LIMIT = 200; // recent ledger entries returned to the panel

const MOVEMENT_TYPES = new Set(["receive", "adjust", "sell", "return", "correction"]);

// ── small helpers ────────────────────────────────────────────────────────────
function str(v) {
  return v == null ? "" : String(v);
}

function trimmed(v, max) {
  const s = str(v).trim();
  return max ? s.slice(0, max) : s;
}

// Product images surface on the public storefront as <img src>; restrict to
// http(s)/root-relative so a stored `javascript:`/`data:`/`//host` value can't
// reach the page (mixed content / phishing), matching the SEO plugin's policy.
function safeImageUrl(value) {
  const s = trimmed(value, 1000);
  if (s === "") return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return "";
}

function nonNegNumber(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative number`);
  return n;
}

function nonNegInt(v, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative whole number`);
  return n;
}

/** Optional non-negative number → number or null (blank/absent allowed). */
function optNumber(v, label) {
  if (v === "" || v === null || v === undefined) return null;
  return nonNegNumber(v, label);
}

function optInt(v, label) {
  if (v === "" || v === null || v === undefined) return null;
  return nonNegInt(v, label);
}

function slugify(v) {
  return str(v)
      .toLowerCase()
      .trim()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
}

function nowIso() {
  return new Date().toISOString();
}

// Monotonic per-process tiebreaker so ledger entries created within the same
// millisecond still order deterministically (the ISO timestamp is the primary
// key; `seq` only disambiguates ties).
let _seq = 0;

function nextSeq() {
  return ++_seq;
}

/** Rounds money to 2 dp, avoiding binary-float drift (e.g. 0.1+0.2). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Money is computed in integer minor units (cents) so a long cart or a tax rate
// can never accumulate binary-float drift. Amounts are stored/returned as
// 2-dp numbers (the storefront/display format), but every +,-,* happens on
// integers. `toCents` rounds half-up at the cent boundary.
function toCents(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100);
}

function fromCents(c) {
  return Math.round(c) / 100;
}

// Serializes ALL stock mutations within this worker. The plugin runs in a single
// worker, but its handlers are async and interleave at every `await` — so two
// concurrent checkouts for the last unit could both read stock, both pass the
// availability check, and both decrement (oversell). Funnelling every stock
// read-modify-write through this chain makes adjustStock's fresh re-read +
// non-negative guard authoritative, and lets createOrder hold the lock across
// its whole validate-then-decrement so nothing changes stock underneath it.
// (Cross-process writes — e.g. an admin order while the public site checks out —
// are rarer; full cross-process safety needs adapter-level CAS, noted in TDD.)
let _stockLock = Promise.resolve();

function withStockLock(fn) {
  const run = _stockLock.then(fn);
  _stockLock = run.then(() => undefined, () => undefined);
  return run;
}

// Sequential number allocator (order/return numbers). Increments are chained so
// two concurrent invokes in the same worker can't read-modify-write the same
// counter and collide.
let _counterChain = Promise.resolve();

function nextNumber(host, key, start) {
  const run = _counterChain.then(async () => {
    const doc = await host.storage.get(COUNTERS, key);
    const current = doc && typeof doc === "object" && Number.isFinite(doc.value) ? doc.value : start - 1;
    const value = current + 1;
    await host.storage.put(COUNTERS, {id: key, value});
    return value;
  });
  _counterChain = run.then(() => undefined, () => undefined);
  return run;
}

/** Reads a whole collection as an array (the adapter caps the page; we work in JS). */
async function all(host, collection) {
  const page = await host.storage.query(collection, undefined, {limit: PAGE});
  return Array.isArray(page?.items) ? page.items : [];
}

/** Ensures `slug` is unique within ITEMS, ignoring the row with `selfId`. */
async function uniqueSlug(host, base, selfId) {
  const taken = new Set(
      (await all(host, ITEMS))
          .filter((p) => p.id !== selfId)
          .map((p) => str(p.slug)),
  );
  let slug = base || "product";
  if (!taken.has(slug)) return slug;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${slug}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${slug}-${randomUUID().slice(0, 6)}`;
}

// ── variants & options ───────────────────────────────────────────────────────

/** Normalises the option axes (e.g. Size → [S,M,L]). Max 3 axes, 30 values each. */
function cleanOptions(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const opt of input.slice(0, 3)) {
    const name = trimmed(opt?.name, 40);
    if (!name) continue;
    const values = Array.isArray(opt?.values)
        ? [...new Set(opt.values.map((v) => trimmed(v, 40)).filter(Boolean))].slice(0, 30)
        : [];
    if (values.length) out.push({name, values});
  }
  return out;
}

/** A human label for a variant from its option values ("S / Black"), else "Default". */
function variantLabel(optionValues) {
  const parts = Object.values(optionValues ?? {}).map(str).filter(Boolean);
  return parts.length ? parts.join(" / ") : "Default";
}

/**
 * Normalises the variant list. Stock is authoritative on variants and is NEVER
 * changed here for an existing variant — stock only moves through the ledger
 * (`adjustStock`). A brand-new variant takes its opening stock from the input
 * and emits an opening "receive" movement (returned for the caller to persist).
 */
function cleanVariants(input, options, existing) {
  const existingById = new Map((existing ?? []).map((v) => [v.id, v]));
  const openings = [];
  let rows = Array.isArray(input) ? input : [];

  // No explicit variants: derive from option axes (cartesian) or a single default.
  if (!rows.length) {
    if (options.length) {
      rows = cartesian(options).map((optionValues) => ({optionValues, stock: 0}));
    } else {
      rows = [{optionValues: {}, stock: 0}];
    }
  }

  const variants = rows.slice(0, 200).map((v) => {
    const optionValues = {};
    for (const opt of options) {
      const val = trimmed(v?.optionValues?.[opt.name], 40);
      if (val) optionValues[opt.name] = val;
    }
    const isExisting = typeof v?.id === "string" && existingById.has(v.id);
    const id = isExisting ? v.id : randomUUID();
    const stock = isExisting ? nonNegInt(existingById.get(id).stock, "Stock") : nonNegInt(v?.stock ?? 0, "Stock");
    if (!isExisting && stock > 0) openings.push({variantId: id, qty: stock});
    return {
      id,
      optionValues,
      label: variantLabel(optionValues),
      sku: trimmed(v?.sku, 64),
      price: optNumber(v?.price, "Variant price"),
      stock,
      lowStockThreshold: optInt(v?.lowStockThreshold, "Low-stock threshold"),
    };
  });

  return {variants, openings};
}

/** Cartesian product of option axes → list of {optName: value} maps. */
function cartesian(options) {
  let acc = [{}];
  for (const opt of options) {
    const next = [];
    for (const combo of acc) for (const value of opt.values) next.push({...combo, [opt.name]: value});
    acc = next;
  }
  return acc;
}

/** Effective unit price for a variant (its own price, else the product base). */
function variantPrice(variant, product) {
  return variant.price != null ? variant.price : product.price;
}

/** Recomputes the denormalised roll-ups stored on a product for fast listing. */
function rollups(product, defaultThreshold) {
  const variants = product.variants ?? [];
  const totalStock = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  const prices = variants.map((v) => variantPrice(v, product));
  const lowStock = variants.some((v) => {
    const threshold = v.lowStockThreshold ?? product.lowStockThreshold ?? defaultThreshold;
    return Number(v.stock) <= Number(threshold);
  });
  return {
    totalStock,
    inStock: totalStock > 0,
    lowStock,
    priceMin: prices.length ? Math.min(...prices) : product.price,
    priceMax: prices.length ? Math.max(...prices) : product.price,
  };
}

// ── settings ─────────────────────────────────────────────────────────────────
const SETTINGS_DEFAULTS = {
  id: "general",
  storeName: "",
  currency: "USD",
  currencySymbol: "$",
  taxRate: 0, // percent
  shippingFlat: 0,
  lowStockThreshold: 5,
};

async function readSettings(host) {
  const doc = await host.storage.get(SETTINGS, "general");
  return {...SETTINGS_DEFAULTS, ...(doc && typeof doc === "object" ? doc : {})};
}

/** @param {unknown} _args @param {import('@pressh/sdk').HostApi} host */
export async function getSettings(_args, host) {
  return {settings: await readSettings(host)};
}

/** @param {{ settings?: Record<string, unknown> }} args @param {import('@pressh/sdk').HostApi} host */
export async function saveSettings(args, host) {
  const input = args?.settings ?? {};
  const settings = {
    id: "general",
    storeName: trimmed(input.storeName, 120),
    currency: trimmed(input.currency, 8).toUpperCase() || "USD",
    currencySymbol: trimmed(input.currencySymbol, 4) || "$",
    taxRate: nonNegNumber(input.taxRate ?? 0, "Tax rate"),
    shippingFlat: nonNegNumber(input.shippingFlat ?? 0, "Shipping"),
    lowStockThreshold: nonNegInt(input.lowStockThreshold ?? 5, "Low-stock threshold"),
  };
  if (settings.taxRate > 100) throw new Error("Tax rate must be a percentage between 0 and 100");
  await host.storage.put(SETTINGS, settings);
  return {settings};
}

// ── categories ───────────────────────────────────────────────────────────────

/** @param {unknown} _args @param {import('@pressh/sdk').HostApi} host */
export async function listCategories(_args, host) {
  const categories = (await all(host, CATEGORIES)).sort((a, b) =>
      str(a.name).localeCompare(str(b.name)),
  );
  return {categories};
}

/** @param {{ category?: Record<string, unknown> }} args @param {import('@pressh/sdk').HostApi} host */
export async function saveCategory(args, host) {
  const input = args?.category ?? {};
  const name = trimmed(input.name, 120);
  if (!name) throw new Error("Category name is required");
  const id = typeof input.id === "string" && input.id ? input.id : randomUUID();
  const category = {
    id,
    name,
    slug: slugify(input.slug || name) || id,
    description: trimmed(input.description, 500),
    parentId: typeof input.parentId === "string" && input.parentId ? input.parentId : null,
    updatedAt: nowIso(),
  };
  if (category.parentId === id) throw new Error("A category cannot be its own parent");
  await host.storage.put(CATEGORIES, category);
  return {category};
}

/** @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function removeCategory(args, host) {
  const id = str(args?.id);
  if (!id) throw new Error("A category id is required");
  // Re-parent children to the removed category's parent so the tree stays valid.
  const removed = await host.storage.get(CATEGORIES, id);
  const parentId = removed && typeof removed === "object" ? removed.parentId ?? null : null;
  for (const child of await all(host, CATEGORIES)) {
    if (child.parentId === id) await host.storage.put(CATEGORIES, {...child, parentId});
  }
  await host.storage.delete(CATEGORIES, id);
  return {ok: true};
}

// ── products ─────────────────────────────────────────────────────────────────

/**
 * Validates + normalises a product into the canonical stored shape. Accepts
 * both the simple legacy form ({name, price, stock}) and the rich form
 * ({options, variants, images, ...}); the simple form becomes a single default
 * variant. Returns the product doc plus any opening stock movements to persist.
 */
async function buildProduct(input, host, settings) {
  const name = trimmed(input?.name, 200);
  if (!name) throw new Error("Name is required");

  const existingId = typeof input?.id === "string" && input.id ? input.id : null;
  const existing = existingId ? await host.storage.get(ITEMS, existingId) : null;
  const id = existingId || randomUUID();

  const price = nonNegNumber(input?.price ?? 0, "Price");
  const compareAtPrice = optNumber(input?.compareAtPrice, "Compare-at price");
  if (compareAtPrice != null && compareAtPrice < price) {
    throw new Error("Compare-at price should be higher than the price");
  }

  const options = cleanOptions(input?.options);
  const existingVariants = existing && typeof existing === "object" && Array.isArray(existing.variants)
      ? existing.variants
      : [];
  // Resolve the variant set. The panel always sends an explicit `variants`
  // array; the simple/legacy form ({name,price,stock}) has none, so we either
  // keep the product's existing variants (an untouched edit), derive them from
  // the option axes, or synthesise one default variant seeded with item.stock.
  let variantsInput = Array.isArray(input?.variants) ? input.variants : null;
  if (!variantsInput) {
    if (existingVariants.length) variantsInput = existingVariants;
    else if (options.length) variantsInput = null;
    else variantsInput = [{optionValues: {}, stock: input?.stock ?? 0}];
  }
  const {variants, openings} = cleanVariants(variantsInput, options, existingVariants);

  const images = Array.isArray(input?.images)
      ? input.images.map((u) => safeImageUrl(u)).filter(Boolean).slice(0, 12)
      : [];
  const tags = Array.isArray(input?.tags)
      ? [...new Set(input.tags.map((t) => trimmed(t, 40)).filter(Boolean))].slice(0, 20)
      : [];

  const slug = await uniqueSlug(host, slugify(input?.slug || name), id);

  const product = {
    id,
    name,
    slug,
    sku: trimmed(input?.sku, 64),
    description: trimmed(input?.description, 5000),
    currency: trimmed(input?.currency, 8).toUpperCase() || settings.currency,
    price,
    compareAtPrice,
    categoryId: typeof input?.categoryId === "string" && input.categoryId ? input.categoryId : null,
    tags,
    images,
    options,
    variants,
    lowStockThreshold: optInt(input?.lowStockThreshold, "Low-stock threshold") ?? settings.lowStockThreshold,
    seoTitle: trimmed(input?.seoTitle, 200),
    seoDescription: trimmed(input?.seoDescription, 320),
    published: input?.published === true,
    createdAt: existing && typeof existing === "object" && existing.createdAt ? existing.createdAt : nowIso(),
    updatedAt: nowIso(),
  };
  Object.assign(product, rollups(product, settings.lowStockThreshold));
  return {product, openings};
}

/** @param {{ item?: Record<string, unknown> }} args @param {import('@pressh/sdk').HostApi} host */
export async function saveItem(args, host) {
  const settings = await readSettings(host);
  const {product, openings} = await buildProduct(args?.item ?? {}, host, settings);
  await host.storage.put(ITEMS, product);
  // Opening stock for newly-added variants is recorded in the ledger so the
  // sum of movements always reconciles with on-hand stock.
  for (const opening of openings) {
    await host.storage.put(MOVEMENTS, {
      id: randomUUID(),
      itemId: product.id,
      variantId: opening.variantId,
      type: "receive",
      qtyDelta: opening.qty,
      balanceAfter: opening.qty,
      reason: "Opening stock",
      ref: null,
      at: nowIso(),
      seq: nextSeq(),
    });
  }
  return {item: product};
}

/** @param {unknown} _args @param {import('@pressh/sdk').HostApi} host */
export async function listItems(_args, host) {
  const settings = await readSettings(host);
  const items = (await all(host, ITEMS))
      .map((p) => ({...p, ...rollups(p, settings.lowStockThreshold)}))
      .sort((a, b) => str(a.name).localeCompare(str(b.name)));
  return {items, defaultLowStockThreshold: settings.lowStockThreshold};
}

/** @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function getItem(args, host) {
  const item = await host.storage.get(ITEMS, str(args?.id));
  if (!item) throw new Error("Product not found");
  return {item};
}

/** @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function removeItem(args, host) {
  const id = str(args?.id);
  if (!id) throw new Error("A product id is required");
  await host.storage.delete(ITEMS, id);
  return { ok: true };
}

// ── stock ledger ─────────────────────────────────────────────────────────────

/**
 * Moves stock for one variant and records an audited ledger entry. `mode:"set"`
 * targets an absolute level; `mode:"delta"` applies a signed change. Stock can
 * never go negative. The product roll-ups are recomputed and persisted.
 *
 * @param {{ itemId?: string, variantId?: string, mode?: "set"|"delta", amount?: number, type?: string, reason?: string, ref?: string }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function adjustStock(args, host) {
  // Public entry: take the stock lock so the fresh-read + non-negative guard
  // below is atomic against any other stock mutation in this worker.
  return withStockLock(() => adjustStockUnlocked(args, host));
}

/**
 * The stock mutation itself. MUST run while the stock lock is held — either via
 * `adjustStock` (which locks) or from within another locked critical section
 * such as `createOrder`. Never call this directly without the lock.
 */
async function adjustStockUnlocked(args, host) {
  const settings = await readSettings(host);
  const item = await host.storage.get(ITEMS, str(args?.itemId));
  if (!item || typeof item !== "object") throw new Error("Product not found");
  const variantId = str(args?.variantId) || (item.variants?.[0]?.id ?? "");
  const variant = (item.variants ?? []).find((v) => v.id === variantId);
  if (!variant) throw new Error("Variant not found");

  const current = Number(variant.stock) || 0;
  const amount = Number(args?.amount);
  if (!Number.isInteger(amount)) throw new Error("Amount must be a whole number");
  const mode = args?.mode === "set" ? "set" : "delta";
  const delta = mode === "set" ? amount - current : amount;
  const balanceAfter = current + delta;
  if (balanceAfter < 0) throw new Error("Stock cannot go below zero");

  const type = MOVEMENT_TYPES.has(args?.type)
      ? args.type
      : delta >= 0
          ? "receive"
          : "adjust";

  variant.stock = balanceAfter;
  Object.assign(item, rollups(item, settings.lowStockThreshold), {updatedAt: nowIso()});
  await host.storage.put(ITEMS, item);

  const movement = {
    id: randomUUID(),
    itemId: item.id,
    variantId,
    type,
    qtyDelta: delta,
    balanceAfter,
    reason: trimmed(args?.reason, 200),
    ref: typeof args?.ref === "string" && args.ref ? args.ref : null,
    at: nowIso(),
    seq: nextSeq(),
  };
  await host.storage.put(MOVEMENTS, movement);
  return {item, movement};
}

/** @param {{ itemId?: string, limit?: number }} args @param {import('@pressh/sdk').HostApi} host */
export async function listMovements(args, host) {
  const itemId = str(args?.itemId);
  const limitRaw = Number(args?.limit ?? MOVEMENTS_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 1000) : MOVEMENTS_LIMIT;
  const movements = (await all(host, MOVEMENTS))
      .filter((m) => (itemId ? m.itemId === itemId : true))
      .sort((a, b) => {
        const t = str(b.at).localeCompare(str(a.at));
        return t !== 0 ? t : (Number(b.seq) || 0) - (Number(a.seq) || 0);
      })
      .slice(0, limit);
  return {movements};
}

// ── public storefront feed ───────────────────────────────────────────────────

/** Safe public projection of a single product (no internal fields leaked). */
function publicProjection(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku ?? "",
    description: product.description ?? "",
    currency: product.currency ?? "USD",
    price: product.priceMin ?? product.price,
    priceMin: product.priceMin ?? product.price,
    priceMax: product.priceMax ?? product.price,
    compareAtPrice: product.compareAtPrice ?? null,
    image: (product.images && product.images[0]) || "",
    images: product.images ?? [],
    categoryId: product.categoryId ?? null,
    tags: product.tags ?? [],
    inStock: (product.totalStock ?? 0) > 0,
    totalStock: product.totalStock ?? 0,
    options: product.options ?? [],
    variants: (product.variants ?? []).map((v) => ({
      id: v.id,
      label: v.label ?? variantLabel(v.optionValues),
      optionValues: v.optionValues ?? {},
      sku: v.sku ?? "",
      price: variantPrice(v, product),
      stock: v.stock ?? 0,
      inStock: (v.stock ?? 0) > 0,
    })),
  };
}

/**
 * Storefront product feed — published products, optionally filtered/sorted.
 * Used by the site renderer (CollectionList source) and storefront client.
 *
 * @param {{ category?: string, tag?: string, search?: string, sort?: string, limit?: number, inStockOnly?: boolean }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function feed(args, host) {
  const settings = await readSettings(host);
  let items = (await all(host, ITEMS))
      .filter((p) => p.published === true)
      .map((p) => ({...p, ...rollups(p, settings.lowStockThreshold)}));

  const category = str(args?.category);
  if (category) items = items.filter((p) => p.categoryId === category || p.slug === category);
  const tag = str(args?.tag);
  if (tag) items = items.filter((p) => Array.isArray(p.tags) && p.tags.includes(tag));
  if (args?.inStockOnly) items = items.filter((p) => (p.totalStock ?? 0) > 0);
  const search = str(args?.search).toLowerCase().trim();
  if (search) {
    items = items.filter((p) =>
        [p.name, p.sku, p.description, ...(p.tags ?? [])].some((f) => str(f).toLowerCase().includes(search)),
    );
  }

  const sort = str(args?.sort);
  items.sort((a, b) => {
    if (sort === "price-asc") return (a.priceMin ?? 0) - (b.priceMin ?? 0);
    if (sort === "price-desc") return (b.priceMin ?? 0) - (a.priceMin ?? 0);
    if (sort === "newest") return str(b.createdAt).localeCompare(str(a.createdAt));
    return str(a.name).localeCompare(str(b.name));
  });

  const limitRaw = Number(args?.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 200) : 50;
  const symbol = settings.currencySymbol || "$";
  const projected = items.slice(0, limit).map((p) => {
    const proj = publicProjection(p);
    proj.priceLabel = symbol + Number(proj.price ?? 0).toFixed(2);
    proj.compareAtLabel = proj.compareAtPrice != null ? symbol + Number(proj.compareAtPrice).toFixed(2) : "";
    return proj;
  });
  return {items: projected, currency: settings.currency, currencySymbol: symbol};
}

/**
 * Public feed for the bundled `GET /items` endpoint — published, in-stock only,
 * safe projection. Kept as the historical entry point.
 */
export async function publicItems(args, host) {
  const out = await feed({...(args ?? {}), inStockOnly: true}, host);
  return {items: out.items, currency: out.currency};
}

/**
 * Public cart preview — resolves a client cart [{itemId, variantId, qty}] to
 * authoritative, formatted line items + totals. Lenient (never throws): missing
 * products are flagged `removed`, over-ordered lines are flagged `adjusted` and
 * counted at the available quantity. The client uses this to render the cart and
 * checkout summary; checkout re-validates strictly server-side.
 *
 * @param {{ items?: Array<{itemId?:string,variantId?:string,qty?:number}> }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function cartPreview(args, host) {
  const settings = await readSettings(host);
  const symbol = settings.currencySymbol || "$";
  const fmt = (n) => symbol + (Number(n) || 0).toFixed(2);
  const requested = Array.isArray(args?.items) ? args.items.slice(0, 100) : [];

  const lines = [];
  for (const raw of requested) {
    const itemId = str(raw?.itemId);
    let qty = Number(raw?.qty);
    qty = Number.isInteger(qty) && qty > 0 ? Math.min(qty, 999) : 1;
    const product = await host.storage.get(ITEMS, itemId);
    if (!product || typeof product !== "object" || product.published !== true) {
      lines.push({itemId, variantId: str(raw?.variantId), removed: true, name: "Unavailable item", qty, available: 0});
      continue;
    }
    const variants = product.variants ?? [];
    const variantId = str(raw?.variantId) || (variants[0]?.id ?? "");
    const variant = variants.find((v) => v.id === variantId);
    if (!variant) {
      lines.push({itemId, variantId, removed: true, name: product.name, qty, available: 0});
      continue;
    }
    const available = Number(variant.stock) || 0;
    const usableQty = Math.max(0, Math.min(qty, available));
    const unitPrice = variantPrice(variant, product);
    const lineTotal = round2(unitPrice * usableQty);
    lines.push({
      itemId,
      variantId,
      name: product.name,
      variantLabel: variant.label || variantLabel(variant.optionValues),
      image: (product.images && product.images[0]) || "",
      sku: variant.sku || product.sku || "",
      unitPrice,
      unitPriceLabel: fmt(unitPrice),
      qty,
      usableQty,
      available,
      adjusted: usableQty !== qty,
      lineTotal,
      lineTotalLabel: fmt(lineTotal),
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + (l.lineTotal || 0), 0));
  const {tax, shipping, total} = computeTotals(subtotal, settings, {});
  return {
    lines,
    currency: settings.currency,
    currencySymbol: symbol,
    subtotal,
    subtotalLabel: fmt(subtotal),
    tax,
    taxLabel: fmt(tax),
    taxRate: settings.taxRate,
    shipping,
    shippingLabel: fmt(shipping),
    total,
    totalLabel: fmt(total),
  };
}

/**
 * Public checkout — creates a real order from the client cart + customer
 * details. Delegates to createOrder (server-authoritative pricing, stock
 * validation + decrement), tagging the order as storefront-sourced.
 *
 * @param {{ items?: unknown[], customer?: Record<string,unknown>, note?: string }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function checkout(args, host) {
  // Honeypot: a hidden `_hp` field no human fills. A filled value is a bot, so
  // silently succeed without creating an order or touching stock (matches the
  // forms plugin's abuse defence; the per-IP rate limit is the other layer).
  if (typeof args?._hp === "string" && args._hp.trim() !== "") {
    return {ok: true, orderId: "", orderNumber: 0, total: 0, totalLabel: ""};
  }
  const items = Array.isArray(args?.items)
      ? args.items.map((i) => ({itemId: i?.itemId, variantId: i?.variantId, qty: i?.qty}))
      : [];
  const {order} = await createOrder(
      {lines: items, customer: args?.customer, note: args?.note, source: "storefront"},
      host,
  );
  const settings = await readSettings(host);
  const symbol = settings.currencySymbol || "$";
  return {
    ok: true,
    orderId: order.id,
    orderNumber: order.number,
    total: order.total,
    totalLabel: symbol + Number(order.total).toFixed(2),
  };
}

// ── orders ───────────────────────────────────────────────────────────────────

function cleanCustomer(c) {
  return {
    name: trimmed(c?.name, 200),
    email: trimmed(c?.email, 200),
    phone: trimmed(c?.phone, 60),
    address: trimmed(c?.address, 500),
  };
}

/**
 * Resolves raw {itemId, variantId, qty} lines to authoritative, priced order
 * lines — using the *stored* product price and validating availability — so a
 * client can never dictate prices or oversell. Throws before any stock moves.
 */
async function priceLines(host, rawLines) {
  if (!Array.isArray(rawLines) || !rawLines.length) throw new Error("Order has no items");
  const lines = [];
  for (const raw of rawLines.slice(0, 100)) {
    const itemId = str(raw?.itemId);
    const qty = nonNegInt(raw?.qty, "Quantity");
    if (qty < 1) throw new Error("Quantity must be at least 1");
    const product = await host.storage.get(ITEMS, itemId);
    if (!product || typeof product !== "object") throw new Error("A product in the order no longer exists");
    if (product.published !== true) throw new Error(`"${product.name}" is not available`);
    const variants = product.variants ?? [];
    const variantId = str(raw?.variantId) || (variants[0]?.id ?? "");
    const variant = variants.find((v) => v.id === variantId);
    if (!variant) throw new Error(`Selected option for "${product.name}" is unavailable`);
    if ((Number(variant.stock) || 0) < qty) {
      throw new Error(`Only ${Number(variant.stock) || 0} of "${product.name} (${variant.label})" left in stock`);
    }
    const unitPrice = variantPrice(variant, product);
    lines.push({
      itemId,
      variantId,
      name: product.name,
      variantLabel: variant.label || variantLabel(variant.optionValues),
      sku: variant.sku || product.sku || "",
      image: (product.images && product.images[0]) || "",
      unitPrice,
      qty,
      // Line total in exact cents: unit price → cents, then integer multiply.
      lineTotal: fromCents(toCents(unitPrice) * qty),
    });
  }
  const subtotalCents = lines.reduce((s, l) => s + toCents(l.lineTotal), 0);
  return {lines, subtotal: fromCents(subtotalCents)};
}

function computeTotals(subtotal, settings, opts) {
  // All arithmetic in integer cents so tax/discount can't drift.
  const subtotalCents = toCents(subtotal);
  const taxCents = Math.round((subtotalCents * (Number(settings.taxRate) || 0)) / 100);
  const shippingCents = toCents(Math.max(0, Number(settings.shippingFlat) || 0));
  const discountCents = toCents(Math.max(0, Number(opts?.discount) || 0));
  const totalCents = Math.max(0, subtotalCents + taxCents + shippingCents - discountCents);
  return {
    tax: fromCents(taxCents),
    shipping: fromCents(shippingCents),
    discount: fromCents(discountCents),
    total: fromCents(totalCents),
  };
}

/**
 * Creates an order from {lines, customer}. Prices + stock are validated
 * server-side, then stock is decremented through the ledger (one "sell"
 * movement per line, referencing the order). Used by both the admin panel and
 * the public checkout endpoint.
 *
 * @param {{ lines?: unknown[], customer?: Record<string,unknown>, note?: string, discount?: number, source?: string }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function createOrder(args, host) {
  const settings = await readSettings(host);
  const customer = cleanCustomer(args?.customer);
  const source = args?.source === "storefront" ? "storefront" : "admin";
  if (source === "storefront" && (!customer.name || !customer.email)) {
    throw new Error("Name and email are required to place an order");
  }

  // Validate availability AND decrement under a single held lock so no
  // concurrent order can take the same units between the check and the
  // decrement (closes the oversell race). priceLines throws before any stock
  // moves; the decrements that follow are guaranteed to succeed because nothing
  // else can change stock while we hold the lock.
  const {lines, subtotal, number, id} = await withStockLock(async () => {
    const priced = await priceLines(host, args?.lines);
    const orderNumber = await nextNumber(host, "orders", ORDER_START);
    const orderId = randomUUID();
    for (const line of priced.lines) {
      await adjustStockUnlocked(
          {
            itemId: line.itemId,
            variantId: line.variantId,
            mode: "delta",
            amount: -line.qty,
            type: "sell",
            reason: `Order #${orderNumber}`,
            ref: orderId,
          },
          host,
      );
    }
    return {lines: priced.lines, subtotal: priced.subtotal, number: orderNumber, id: orderId};
  });

  const {tax, shipping, discount, total} = computeTotals(subtotal, settings, {discount: args?.discount});

  const order = {
    id,
    number,
    status: "pending",
    lines,
    subtotal,
    tax,
    shipping,
    discount,
    total,
    currency: settings.currency,
    customer,
    // Top-level subject reference (lowercased email) so the GDPR service — which
    // matches on a flat field — can find a customer's orders for export/erasure.
    subjectRef: customer.email.toLowerCase(),
    note: trimmed(args?.note, 1000),
    source,
    paymentStatus: "unpaid",
    amountPaid: 0,
    amountRefunded: 0,
    restocked: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await host.storage.put(ORDERS, order);
  return {order};
}

/** @param {{ status?: string, search?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function listOrders(args, host) {
  let orders = await all(host, ORDERS);
  const status = str(args?.status);
  if (status) orders = orders.filter((o) => o.status === status);
  const search = str(args?.search).toLowerCase().trim();
  if (search) {
    orders = orders.filter((o) =>
        [o.number, o.customer?.name, o.customer?.email].some((f) => str(f).toLowerCase().includes(search)),
    );
  }
  orders.sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
  return {orders};
}

/** @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function getOrder(args, host) {
  const order = await host.storage.get(ORDERS, str(args?.id));
  if (!order) throw new Error("Order not found");
  const payments = (await all(host, PAYMENTS))
      .filter((p) => p.orderId === order.id)
      .sort((a, b) => str(a.at).localeCompare(str(b.at)));
  const returns = (await all(host, RETURNS)).filter((r) => r.orderId === order.id);
  return {order, payments, returns};
}

/** @param {{ id?: string, status?: string, restock?: boolean }} args @param {import('@pressh/sdk').HostApi} host */
export async function updateOrderStatus(args, host) {
  const to = str(args?.status);
  if (!ORDER_STATUSES.has(to)) throw new Error("Invalid order status");
  if (to === "cancelled") return cancelOrder({id: args?.id, restock: args?.restock !== false}, host);
  const order = await host.storage.get(ORDERS, str(args?.id));
  if (!order) throw new Error("Order not found");
  order.status = to;
  order.updatedAt = nowIso();
  await host.storage.put(ORDERS, order);
  return {order};
}

/** @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function fulfillOrder(args, host) {
  return updateOrderStatus({id: args?.id, status: "fulfilled"}, host);
}

/** Cancels an order and (by default) returns its stock to inventory. */
export async function cancelOrder(args, host) {
  const order = await host.storage.get(ORDERS, str(args?.id));
  if (!order) throw new Error("Order not found");
  if (order.status === "cancelled") return {order};
  // A fulfilled order's goods have shipped — cancelling it would restock units
  // that physically left inventory (double counting). Such an order must be
  // unwound through a Return instead, which restocks only what comes back.
  if (order.status === "fulfilled" || order.status === "refunded") {
    throw new Error(`Cannot cancel a ${order.status} order — process a return instead`);
  }
  const restock = args?.restock !== false;
  if (restock && !order.restocked) {
    for (const line of order.lines ?? []) {
      await adjustStock(
          {
            itemId: line.itemId,
            variantId: line.variantId,
            mode: "delta",
            amount: line.qty,
            type: "return",
            reason: `Cancelled order #${order.number}`,
            ref: order.id
          },
          host,
      ).catch(() => undefined); // a deleted product can't be restocked — cancel anyway
    }
    order.restocked = true;
  }
  order.status = "cancelled";
  order.updatedAt = nowIso();
  await host.storage.put(ORDERS, order);
  return {order};
}

// ── payments (recorded + pluggable gateway seam) ──────────────────────────────

/**
 * Payment gateways. Only `manual` ships today — it records the payment without
 * any external call. A real processor (Stripe, …) implements the same
 * {charge, refund} shape and is selected per request, with no other changes.
 */
const GATEWAYS = {
  manual: {
    async charge() {
      return {status: "recorded", ref: null};
    },
    async refund() {
      return {status: "recorded", ref: null};
    },
  },
};

/** Derives an order's payment status from its paid/refunded ledger totals. */
function recomputePaymentStatus(order) {
  const total = Number(order.total) || 0;
  const paid = round2(Number(order.amountPaid) || 0);
  const refunded = round2(Number(order.amountRefunded) || 0);
  const net = round2(paid - refunded);
  if (refunded > 0 && refunded >= total) order.paymentStatus = "refunded";
  else if (refunded > 0) order.paymentStatus = "partial";
  else if (total > 0 && net >= total) order.paymentStatus = "paid";
  else if (net > 0) order.paymentStatus = "partial";
  else order.paymentStatus = "unpaid";
}

/** @param {{ orderId?: string, amount?: number, method?: string, note?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function recordPayment(args, host) {
  const order = await host.storage.get(ORDERS, str(args?.orderId));
  if (!order) throw new Error("Order not found");
  const amount = nonNegNumber(args?.amount, "Amount");
  if (amount <= 0) throw new Error("Payment amount must be greater than zero");
  const method = PAYMENT_METHODS.has(args?.method) ? args.method : "manual";
  const result = await GATEWAYS.manual.charge({amount, method});

  const payment = {
    id: randomUUID(),
    orderId: order.id,
    orderNumber: order.number,
    kind: "payment",
    amount: round2(amount),
    method,
    status: result.status,
    gateway: "manual",
    gatewayRef: result.ref,
    note: trimmed(args?.note, 200),
    at: nowIso(),
    seq: nextSeq(),
  };
  await host.storage.put(PAYMENTS, payment);

  order.amountPaid = round2((Number(order.amountPaid) || 0) + amount);
  recomputePaymentStatus(order);
  if (order.paymentStatus === "paid" && order.status === "pending") order.status = "paid";
  order.updatedAt = nowIso();
  await host.storage.put(ORDERS, order);
  return {order, payment};
}

/** @param {{ orderId?: string, amount?: number, method?: string, note?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function refundPayment(args, host) {
  const order = await host.storage.get(ORDERS, str(args?.orderId));
  if (!order) throw new Error("Order not found");
  const amount = nonNegNumber(args?.amount, "Amount");
  if (amount <= 0) throw new Error("Refund amount must be greater than zero");
  const maxRefund = round2((Number(order.amountPaid) || 0) - (Number(order.amountRefunded) || 0));
  if (amount > maxRefund + 1e-9) throw new Error(`Cannot refund more than the ${maxRefund} collected`);
  const method = PAYMENT_METHODS.has(args?.method) ? args.method : "manual";
  const result = await GATEWAYS.manual.refund({amount, method});

  const payment = {
    id: randomUUID(),
    orderId: order.id,
    orderNumber: order.number,
    kind: "refund",
    amount: round2(amount),
    method,
    status: result.status,
    gateway: "manual",
    gatewayRef: result.ref,
    note: trimmed(args?.note, 200),
    at: nowIso(),
    seq: nextSeq(),
  };
  await host.storage.put(PAYMENTS, payment);

  order.amountRefunded = round2((Number(order.amountRefunded) || 0) + amount);
  recomputePaymentStatus(order);
  if (order.paymentStatus === "refunded") order.status = "refunded";
  order.updatedAt = nowIso();
  await host.storage.put(ORDERS, order);
  return {order, payment};
}

/** @param {{ orderId?: string, limit?: number }} args @param {import('@pressh/sdk').HostApi} host */
export async function listPayments(args, host) {
  const orderId = str(args?.orderId);
  const payments = (await all(host, PAYMENTS))
      .filter((p) => (orderId ? p.orderId === orderId : true))
      .sort((a, b) => {
        const t = str(b.at).localeCompare(str(a.at));
        return t !== 0 ? t : (Number(b.seq) || 0) - (Number(a.seq) || 0);
      });
  return {payments};
}

// ── returns ──────────────────────────────────────────────────────────────────

function lineKey(itemId, variantId) {
  return `${itemId}::${variantId}`;
}

/** @param {{ orderId?: string, lines?: unknown[], reason?: string, restock?: boolean }} args @param {import('@pressh/sdk').HostApi} host */
export async function createReturn(args, host) {
  const order = await host.storage.get(ORDERS, str(args?.orderId));
  if (!order) throw new Error("Order not found");
  const byKey = new Map((order.lines ?? []).map((l) => [lineKey(l.itemId, l.variantId), l]));
  const rawLines = Array.isArray(args?.lines) ? args.lines : [];
  if (!rawLines.length) throw new Error("Select at least one item to return");

  // Quantity already returned per order line across all prior (non-rejected)
  // returns. Without this, several returns could each be capped at the order
  // line qty and collectively restock/refund more than was purchased.
  const priorReturns = (await all(host, RETURNS)).filter(
      (r) => r.orderId === order.id && r.status !== "rejected",
  );
  const alreadyReturned = new Map();
  for (const r of priorReturns) {
    for (const l of r.lines ?? []) {
      const k = lineKey(l.itemId, l.variantId);
      alreadyReturned.set(k, (alreadyReturned.get(k) || 0) + (Number(l.qty) || 0));
    }
  }

  const lines = [];
  for (const raw of rawLines) {
    const key = lineKey(str(raw?.itemId), str(raw?.variantId));
    const orderLine = byKey.get(key);
    if (!orderLine) throw new Error("A return line does not match the order");
    const qty = nonNegInt(raw?.qty, "Quantity");
    const remaining = orderLine.qty - (alreadyReturned.get(key) || 0);
    if (remaining <= 0) {
      throw new Error(`All "${orderLine.name}" units on this order have already been returned`);
    }
    if (qty < 1 || qty > remaining) {
      throw new Error(`Return quantity for "${orderLine.name}" must be between 1 and ${remaining}`);
    }
    lines.push({
      itemId: orderLine.itemId,
      variantId: orderLine.variantId,
      name: orderLine.name,
      variantLabel: orderLine.variantLabel,
      qty,
      unitPrice: orderLine.unitPrice,
      lineRefund: round2(orderLine.unitPrice * qty),
    });
  }
  const number = await nextNumber(host, "returns", RETURN_START);
  const ret = {
    id: randomUUID(),
    number,
    orderId: order.id,
    orderNumber: order.number,
    status: "requested",
    lines,
    reason: trimmed(args?.reason, 500),
    refundAmount: round2(lines.reduce((s, l) => s + l.lineRefund, 0)),
    restock: args?.restock !== false,
    restocked: false,
    refunded: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await host.storage.put(RETURNS, ret);
  return {return: ret};
}

/** @param {{ status?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function listReturns(args, host) {
  let returns = await all(host, RETURNS);
  const status = str(args?.status);
  if (status) returns = returns.filter((r) => r.status === status);
  returns.sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
  return {returns};
}

/** @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function getReturn(args, host) {
  const ret = await host.storage.get(RETURNS, str(args?.id));
  if (!ret) throw new Error("Return not found");
  return {return: ret};
}

/** @param {{ id?: string, status?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function updateReturnStatus(args, host) {
  const ret = await host.storage.get(RETURNS, str(args?.id));
  if (!ret) throw new Error("Return not found");
  const to = str(args?.status);
  if (!RETURN_STATUSES.has(to)) throw new Error("Invalid return status");
  ret.status = to;
  ret.updatedAt = nowIso();
  await host.storage.put(RETURNS, ret);
  return {return: ret};
}

/**
 * Completes a return: optionally restocks the returned units (ledger "return"
 * movements) and issues a refund (up to the order's collected balance). Sets the
 * return to "refunded" when money was returned, otherwise "received".
 *
 * @param {{ id?: string, restock?: boolean, issueRefund?: boolean }} args
 * @param {import('@pressh/sdk').HostApi} host
 */
export async function processReturn(args, host) {
  const ret = await host.storage.get(RETURNS, str(args?.id));
  if (!ret) throw new Error("Return not found");
  if (ret.status === "refunded") throw new Error("This return is already completed");

  const restock = args?.restock != null ? args.restock !== false : ret.restock !== false;
  if (restock && !ret.restocked) {
    for (const line of ret.lines ?? []) {
      await adjustStock(
          {
            itemId: line.itemId,
            variantId: line.variantId,
            mode: "delta",
            amount: line.qty,
            type: "return",
            reason: `Return #${ret.number}`,
            ref: ret.id
          },
          host,
      ).catch(() => undefined);
    }
    ret.restocked = true;
  }

  let refund = null;
  const issueRefund = args?.issueRefund !== false;
  if (issueRefund && !ret.refunded) {
    const order = await host.storage.get(ORDERS, ret.orderId);
    const maxRefund = order ? round2((Number(order.amountPaid) || 0) - (Number(order.amountRefunded) || 0)) : 0;
    const amount = round2(Math.min(ret.refundAmount, maxRefund));
    if (amount > 0) {
      refund = (await refundPayment({
        orderId: ret.orderId,
        amount,
        method: "manual",
        note: `Return #${ret.number}`
      }, host)).payment;
      ret.refunded = true;
    }
  }

  ret.status = ret.refunded ? "refunded" : "received";
  ret.updatedAt = nowIso();
  await host.storage.put(RETURNS, ret);
  return {return: ret, refund};
}

// ── dashboard ────────────────────────────────────────────────────────────────

/** @param {unknown} _args @param {import('@pressh/sdk').HostApi} host */
export async function summary(_args, host) {
  const settings = await readSettings(host);
  const products = (await all(host, ITEMS)).map((p) => ({...p, ...rollups(p, settings.lowStockThreshold)}));
  const lowStockProducts = products
      .filter((p) => p.lowStock)
      .map((p) => ({id: p.id, name: p.name, totalStock: p.totalStock}));

  const orders = await all(host, ORDERS);
  const ordersByStatus = {};
  let revenue = 0;
  let refunded = 0;
  let outstanding = 0;
  for (const o of orders) {
    ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1;
    if (o.status === "cancelled") continue;
    revenue += Number(o.amountPaid) || 0;
    refunded += Number(o.amountRefunded) || 0;
    outstanding += Math.max(0, (Number(o.total) || 0) - ((Number(o.amountPaid) || 0) - (Number(o.amountRefunded) || 0)));
  }

  const recentOrders = orders
      .slice()
      .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)))
      .slice(0, 5)
      .map((o) => ({
        id: o.id,
        number: o.number,
        total: o.total,
        status: o.status,
        paymentStatus: o.paymentStatus,
        customer: o.customer?.name || o.customer?.email || "—",
        createdAt: o.createdAt,
    }));

  return {
    currency: settings.currency,
    currencySymbol: settings.currencySymbol,
    counts: {
      products: products.length,
      published: products.filter((p) => p.published).length,
      lowStock: lowStockProducts.length,
      categories: (await all(host, CATEGORIES)).length,
      orders: orders.length,
    },
    revenue: round2(revenue - refunded),
    outstanding: round2(outstanding),
    refunded: round2(refunded),
    ordersByStatus,
    recentOrders,
    lowStockProducts: lowStockProducts.slice(0, 10),
  };
}

// ── legacy aliases (direct host.invoke callers + load test) ───────────────────
export const save = saveItem;
export const remove = removeItem;
export const list = listItems;
