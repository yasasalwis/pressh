// Inventory — product/stock management. Items live in the `inventory_items`
// collection; the plugin holds only the two scoped capabilities it needs
// (read+write that one collection) and nothing else. The public storefront
// endpoint exposes a safe projection of published, in-stock items only.

import { randomUUID } from "node:crypto";

const COLLECTION = "inventory_items";
const MAX = 200;

/** Validates + normalises an item, throwing a user-facing message on bad input. */
function clean(item) {
  const name = String(item?.name ?? "").trim();
  if (!name) throw new Error("Name is required");
  if (name.length > 200) throw new Error("Name must be 200 characters or fewer");
  const price = Number(item?.price);
  if (!Number.isFinite(price) || price < 0) throw new Error("Price must be a non-negative number");
  const stock = Number(item?.stock);
  if (!Number.isInteger(stock) || stock < 0) throw new Error("Stock must be a non-negative whole number");
  return {
    name,
    price,
    stock,
    sku: String(item?.sku ?? "").trim().slice(0, 64),
    description: String(item?.description ?? "").slice(0, 2000),
    published: item?.published === true,
  };
}

/** @param {unknown} _args @param {import('@pressh/sdk').HostApi} host */
export async function list(_args, host) {
  const page = await host.storage.query(COLLECTION, undefined, { limit: MAX });
  const items = page.items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { items };
}

/** @param {{ item?: Record<string, unknown> }} args @param {import('@pressh/sdk').HostApi} host */
export async function save(args, host) {
  const fields = clean(args?.item ?? {});
  const existingId = args?.item?.id;
  const id = typeof existingId === "string" && existingId ? existingId : randomUUID();
  const doc = { id, ...fields, inStock: fields.stock > 0, updatedAt: new Date().toISOString() };
  await host.storage.put(COLLECTION, doc);
  return { item: doc };
}

/** @param {{ id?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function remove(args, host) {
  const id = String(args?.id ?? "");
  if (!id) throw new Error("An item id is required");
  await host.storage.delete(COLLECTION, id);
  return { ok: true };
}

/** Public storefront feed — published + in-stock only, internal fields stripped. */
export async function publicItems(_args, host) {
  const page = await host.storage.query(COLLECTION, undefined, { limit: MAX });
  const items = page.items
    .filter((it) => it.published === true && Number(it.stock) > 0)
    .map((it) => ({
      id: it.id,
      name: it.name,
      price: it.price,
      stock: it.stock,
      sku: it.sku,
      description: it.description,
    }));
  return { items };
}
