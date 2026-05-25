import { describe, expect, it } from "vitest";

// The built-in plugin handlers are plain functions of (args, host). We exercise
// them directly against an in-memory fake of the capability-gated HostApi —
// fast, and independent of the worker transport (which host.test.ts covers).
import * as inventory from "../builtins/inventory/index.mjs";
import * as forms from "../builtins/forms/index.mjs";
import * as seo from "../builtins/seo/index.mjs";
import * as analytics from "../builtins/analytics/index.mjs";
import * as db from "../builtins/db/index.mjs";

function makeHost() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  const coll = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };
  return {
    _store: store,
    log() {},
    storage: {
      async get(name: string, id: string) {
        return store.get(name)?.get(id) ?? null;
      },
      async put(name: string, doc: { id: string }) {
        coll(name).set(doc.id, doc as Record<string, unknown>);
      },
      async delete(name: string, id: string) {
        store.get(name)?.delete(id);
      },
      async query(name: string) {
        return { items: [...(store.get(name)?.values() ?? [])], nextCursor: null };
      },
      async list() {
        return [...store.keys()];
      },
    },
    secrets: { async get() { return ""; } },
  };
}

describe("inventory plugin", () => {
  it("saves a valid item, projects safe public fields, and deletes", async () => {
    const host = makeHost();
    const saved = await inventory.save({ item: { name: "Mug", price: 9.5, stock: 3, published: true } }, host);
    expect(saved.item.id).toBeTruthy();
    expect(saved.item.inStock).toBe(true);

    const draft = await inventory.save({ item: { name: "Secret", price: 1, stock: 5, published: false } }, host);
    const out = await inventory.publicItems({}, host);
    expect(out.items).toHaveLength(1); // unpublished item excluded
    expect(out.items[0]).toEqual({ id: saved.item.id, name: "Mug", price: 9.5, stock: 3, sku: "", description: "" });

    await inventory.remove({ id: draft.item.id }, host);
    expect(host._store.get("inventory_items")?.has(draft.item.id)).toBe(false);
  });

  it("rejects invalid input", async () => {
    const host = makeHost();
    await expect(inventory.save({ item: { name: "", price: 1, stock: 1 } }, host)).rejects.toThrow(/name/i);
    await expect(inventory.save({ item: { name: "X", price: -1, stock: 1 } }, host)).rejects.toThrow(/price/i);
    await expect(inventory.save({ item: { name: "X", price: 1, stock: 1.5 } }, host)).rejects.toThrow(/stock/i);
  });
});

describe("forms plugin", () => {
  it("drops honeypot spam silently and stores real submissions with a subjectRef", async () => {
    const host = makeHost();
    const spam = await forms.submit({ _hp: "i-am-a-bot", fields: { email: "x@y.z" } }, host);
    expect(spam).toEqual({ ok: true });
    expect(host._store.get("form_submissions")?.size ?? 0).toBe(0);

    const real = await forms.submit({ fields: { email: "a@b.com", message: "hi" }, consent: true }, host);
    expect(real.ok).toBe(true);
    const list = await forms.list({}, host);
    expect(list.items).toHaveLength(1);
    expect(list.items[0].subjectRef).toBe("a@b.com");
    expect(list.items[0].consent).toBe(true);

    await forms.remove({ id: real.id }, host);
    expect(host._store.get("form_submissions")?.size).toBe(0);
  });
});

describe("seo plugin", () => {
  it("strips unsafe ogImage URLs and merges overrides over defaults", async () => {
    const host = makeHost();
    await seo.saveDefaults({ meta: { description: "site", ogImage: "javascript:alert(1)" } }, host);
    let meta = await seo.metaFor({ slug: "home" }, host);
    expect(meta.description).toBe("site");
    expect(meta.ogImage).toBe(""); // dangerous scheme rejected

    await seo.saveOverride({ slug: "about", meta: { description: "about page", ogImage: "/og.png" } }, host);
    meta = await seo.metaFor({ slug: "about" }, host);
    expect(meta.description).toBe("about page");
    expect(meta.ogImage).toBe("/og.png");

    await seo.removeOverride({ slug: "about" }, host);
    meta = await seo.metaFor({ slug: "about" }, host);
    expect(meta.description).toBe("site"); // falls back to defaults
  });
});

describe("analytics plugin", () => {
  it("counts page views per day and per path", async () => {
    const host = makeHost();
    await analytics.collect({ path: "/a" }, host);
    await analytics.collect({ path: "/a" }, host);
    await analytics.collect({ path: "/b" }, host);

    const sum = await analytics.summary({ days: 7 }, host);
    expect(sum.total).toBe(3);
    const top = sum.topPaths.find((p: { path: string }) => p.path === "/a");
    expect(top.count).toBe(2);
  });
});

describe("db plugin", () => {
  it("lists collections, requires a collection to query, and exports everything", async () => {
    const host = makeHost();
    await host.storage.put("posts", { id: "p1", title: "Hello" });

    const cols = await db.listCollections({}, host);
    expect(cols.collections).toContain("posts");

    await expect(db.queryCollection({}, host)).rejects.toThrow(/collection/i);
    const page = await db.queryCollection({ collection: "posts" }, host);
    expect(page.items).toHaveLength(1);

    const dump = await db.exportAll({}, host);
    expect(dump.collections.posts).toHaveLength(1);
    expect(dump.exportedAt).toBeTruthy();
  });
});
