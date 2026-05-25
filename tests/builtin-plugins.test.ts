import {describe, expect, it} from "vitest";

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

describe("inventory plugin — catalog", () => {
    it("saves a simple product, derives a default variant, records opening stock, and projects safe public fields", async () => {
    const host = makeHost();
        const saved = await inventory.saveItem({item: {name: "Mug", price: 9.5, stock: 3, published: true}}, host);
    expect(saved.item.id).toBeTruthy();
        expect(saved.item.slug).toBe("mug");
    expect(saved.item.inStock).toBe(true);
        expect(saved.item.totalStock).toBe(3);
        expect(saved.item.variants).toHaveLength(1);
        expect(saved.item.variants[0].stock).toBe(3);

        // Opening stock is recorded in the ledger so movements reconcile with on-hand.
        const movements = [...(host._store.get("inventory_stock_movements")?.values() ?? [])];
        expect(movements).toHaveLength(1);
        expect(movements[0]).toMatchObject({type: "receive", qtyDelta: 3, balanceAfter: 3, itemId: saved.item.id});

        // Drafts and out-of-stock products never reach the public feed.
        await inventory.saveItem({item: {name: "Secret", price: 1, stock: 5, published: false}}, host);
        await inventory.saveItem({item: {name: "Empty", price: 1, stock: 0, published: true}}, host);
    const out = await inventory.publicItems({}, host);
        expect(out.items.map((i: { name: string }) => i.name)).toEqual(["Mug"]);
        expect(out.items[0]).toMatchObject({name: "Mug", price: 9.5, totalStock: 3, inStock: true});
        expect(out.items[0]).not.toHaveProperty("published"); // internal fields stripped
  });

  it("rejects invalid input", async () => {
    const host = makeHost();
      await expect(inventory.saveItem({item: {name: "", price: 1, stock: 1}}, host)).rejects.toThrow(/name/i);
      await expect(inventory.saveItem({item: {name: "X", price: -1, stock: 1}}, host)).rejects.toThrow(/price/i);
      await expect(inventory.saveItem({item: {name: "X", price: 1, stock: 1.5}}, host)).rejects.toThrow(/stock/i);
  });

    it("builds variants from option axes and preserves variant stock across edits", async () => {
        const host = makeHost();
        const created = await inventory.saveItem(
            {
                item: {
                    name: "Tee",
                    price: 20,
                    published: true,
                    options: [{name: "Size", values: ["S", "M"]}],
                    variants: [
                        {optionValues: {Size: "S"}, stock: 5},
                        {optionValues: {Size: "M"}, stock: 0},
                    ],
                },
            },
            host,
        );
        expect(created.item.variants).toHaveLength(2);
        expect(created.item.totalStock).toBe(5);
        const small = created.item.variants.find((v: { label: string }) => v.label === "S");
        expect(small.stock).toBe(5);

        // Re-save with the same variant ids but tampered stock — stock must be ignored
        // (it only moves through the ledger), so the on-hand total is unchanged.
        const edited = await inventory.saveItem(
            {
                item: {
                    id: created.item.id,
                    name: "Tee",
                    price: 22,
                    options: [{name: "Size", values: ["S", "M"]}],
                    variants: created.item.variants.map((v: { id: string; optionValues: unknown }) => ({
                        id: v.id,
                        optionValues: v.optionValues,
                        stock: 999,
                    })),
                },
            },
            host,
        );
        expect(edited.item.totalStock).toBe(5);
        expect(edited.item.price).toBe(22);
    });

    it("deletes a product", async () => {
        const host = makeHost();
        const saved = await inventory.saveItem({item: {name: "Gone", price: 1, stock: 1}}, host);
        await inventory.removeItem({id: saved.item.id}, host);
        expect(host._store.get("inventory_items")?.has(saved.item.id)).toBe(false);
    });
});

describe("inventory plugin — stock ledger", () => {
    it("receives, sets, and guards stock through audited movements", async () => {
        const host = makeHost();
        const {item} = await inventory.saveItem({item: {name: "Box", price: 4, stock: 2, published: true}}, host);
        const vid = item.variants[0].id;

        const recv = await inventory.adjustStock({
            itemId: item.id,
            variantId: vid,
            mode: "delta",
            amount: 5,
            reason: "restock"
        }, host);
        expect(recv.item.totalStock).toBe(7);
        expect(recv.movement).toMatchObject({type: "receive", qtyDelta: 5, balanceAfter: 7});

        const set = await inventory.adjustStock({
            itemId: item.id,
            variantId: vid,
            mode: "set",
            amount: 3,
            type: "correction"
        }, host);
        expect(set.item.totalStock).toBe(3);
        expect(set.movement.qtyDelta).toBe(-4);

        await expect(
            inventory.adjustStock({itemId: item.id, variantId: vid, mode: "delta", amount: -10}, host),
        ).rejects.toThrow(/below zero/i);

        const {movements} = await inventory.listMovements({itemId: item.id}, host);
        expect(movements).toHaveLength(3); // opening + receive + set, newest first
        expect(movements[0].balanceAfter).toBe(3);
    });

    it("flags low stock against the threshold", async () => {
        const host = makeHost();
        const {item} = await inventory.saveItem({item: {name: "Pen", price: 1, stock: 2, published: true}}, host);
        expect(item.lowStock).toBe(true); // 2 <= default threshold (5)
        const bumped = await inventory.adjustStock({
            itemId: item.id,
            variantId: item.variants[0].id,
            mode: "set",
            amount: 50
        }, host);
        expect(bumped.item.lowStock).toBe(false);
    });
});

describe("inventory plugin — categories & settings", () => {
    it("creates categories and re-parents children when a parent is removed", async () => {
        const host = makeHost();
        const {category: parent} = await inventory.saveCategory({category: {name: "Apparel"}}, host);
        const {category: child} = await inventory.saveCategory({category: {name: "Shirts", parentId: parent.id}}, host);
        expect(child.slug).toBe("shirts");

        let list = await inventory.listCategories({}, host);
        expect(list.categories).toHaveLength(2);

        await inventory.removeCategory({id: parent.id}, host);
        list = await inventory.listCategories({}, host);
        expect(list.categories).toHaveLength(1);
        expect(list.categories[0].parentId).toBeNull(); // child re-parented to root
    });

    it("returns settings defaults, normalises currency, and validates the tax rate", async () => {
        const host = makeHost();
        const {settings} = await inventory.getSettings({}, host);
        expect(settings.currency).toBe("USD");

        const saved = await inventory.saveSettings({
            settings: {
                currency: "eur",
                currencySymbol: "€",
                taxRate: 8.5
            }
        }, host);
        expect(saved.settings.currency).toBe("EUR");
        expect((await inventory.getSettings({}, host)).settings.currencySymbol).toBe("€");

        await expect(inventory.saveSettings({settings: {taxRate: 200}}, host)).rejects.toThrow(/percentage/i);
    });
});

describe("inventory plugin — orders, payments & returns", () => {
    async function seedProduct(host: ReturnType<typeof makeHost>, stock = 5, price = 10) {
        const {item} = await inventory.saveItem({item: {name: "Chair", price, stock, published: true}}, host);
        return item;
    }

    it("creates an order, decrements stock through the ledger, and marks it paid", async () => {
        const host = makeHost();
        const item = await seedProduct(host, 5, 10);
        const vid = item.variants[0].id;
        const {order} = await inventory.createOrder(
            {
                lines: [{itemId: item.id, variantId: vid, qty: 2}],
                customer: {name: "Ann", email: "a@b.c"},
                source: "storefront"
            },
            host,
        );
        expect(order.number).toBeGreaterThanOrEqual(1000);
        expect(order.subtotal).toBe(20);
        expect(order.total).toBe(20);
        expect(order.paymentStatus).toBe("unpaid");
        expect((await inventory.getItem({id: item.id}, host)).item.variants[0].stock).toBe(3);

        const paid = await inventory.recordPayment({orderId: order.id, amount: 20, method: "card"}, host);
        expect(paid.order.paymentStatus).toBe("paid");
        expect(paid.order.status).toBe("paid");

        const ful = await inventory.fulfillOrder({id: order.id}, host);
        expect(ful.order.status).toBe("fulfilled");
    });

    it("rejects an order that oversells and never moves stock", async () => {
        const host = makeHost();
        const item = await seedProduct(host, 1, 5);
        await expect(
            inventory.createOrder({
                lines: [{itemId: item.id, variantId: item.variants[0].id, qty: 5}],
                customer: {name: "X", email: "x@y.z"},
                source: "storefront"
            }, host),
        ).rejects.toThrow(/stock/i);
        expect((await inventory.getItem({id: item.id}, host)).item.variants[0].stock).toBe(1);
    });

    it("requires customer details for storefront orders", async () => {
        const host = makeHost();
        const item = await seedProduct(host);
        await expect(
            inventory.createOrder({
                lines: [{itemId: item.id, variantId: item.variants[0].id, qty: 1}],
                customer: {},
                source: "storefront"
            }, host),
        ).rejects.toThrow(/required/i);
    });

    it("cancels an order and returns its stock to inventory", async () => {
        const host = makeHost();
        const item = await seedProduct(host, 5, 10);
        const {order} = await inventory.createOrder(
            {lines: [{itemId: item.id, variantId: item.variants[0].id, qty: 3}], customer: {name: "A", email: "a@b.c"}},
            host,
        );
        expect((await inventory.getItem({id: item.id}, host)).item.variants[0].stock).toBe(2);
        const cancelled = await inventory.cancelOrder({id: order.id}, host);
        expect(cancelled.order.status).toBe("cancelled");
        expect((await inventory.getItem({id: item.id}, host)).item.variants[0].stock).toBe(5);
    });

    it("processes a return: restocks the items and refunds up to the amount paid", async () => {
        const host = makeHost();
        const item = await seedProduct(host, 5, 10);
        const vid = item.variants[0].id;
        const {order} = await inventory.createOrder(
            {lines: [{itemId: item.id, variantId: vid, qty: 2}], customer: {name: "A", email: "a@b.c"}},
            host,
        );
        await inventory.recordPayment({orderId: order.id, amount: 20, method: "card"}, host);

        const {return: ret} = await inventory.createReturn(
            {orderId: order.id, lines: [{itemId: item.id, variantId: vid, qty: 1}], reason: "changed mind"},
            host,
        );
        expect(ret.refundAmount).toBe(10);
        expect(ret.status).toBe("requested");

        const done = await inventory.processReturn({id: ret.id}, host);
        expect(done.return.status).toBe("refunded");
        expect((await inventory.getItem({id: item.id}, host)).item.variants[0].stock).toBe(4); // 3 after sale + 1 restocked

        const fresh = await inventory.getOrder({id: order.id}, host);
        expect(fresh.order.amountRefunded).toBe(10);
        expect(fresh.order.paymentStatus).toBe("partial");
    });

    it("guards refunds beyond the collected amount", async () => {
        const host = makeHost();
        const item = await seedProduct(host, 5, 10);
        const {order} = await inventory.createOrder(
            {lines: [{itemId: item.id, variantId: item.variants[0].id, qty: 1}], customer: {name: "A", email: "a@b.c"}},
            host,
        );
        await inventory.recordPayment({orderId: order.id, amount: 10, method: "cash"}, host);
        await expect(inventory.refundPayment({orderId: order.id, amount: 20}, host)).rejects.toThrow(/refund/i);
    });

    it("summarises store activity on the dashboard", async () => {
        const host = makeHost();
        const item = await seedProduct(host, 2, 15); // 2 <= default threshold (5) → low stock
        const {order} = await inventory.createOrder(
            {lines: [{itemId: item.id, variantId: item.variants[0].id, qty: 1}], customer: {name: "A", email: "a@b.c"}},
            host,
        );
        await inventory.recordPayment({orderId: order.id, amount: 15, method: "card"}, host);
        const s = await inventory.summary({}, host);
        expect(s.counts.orders).toBe(1);
        expect(s.counts.lowStock).toBeGreaterThanOrEqual(1);
        expect(s.revenue).toBe(15);
  });
});

describe("inventory plugin — storefront cart & checkout", () => {
    it("previews a cart with authoritative pricing and flags over-orders / missing items", async () => {
        const host = makeHost();
        const a = await inventory.saveItem({item: {name: "A", price: 10, stock: 2, published: true}}, host);
        const b = await inventory.saveItem({item: {name: "B", price: 5, stock: 4, published: true}}, host);
        const preview = await inventory.cartPreview(
            {
                items: [
                    {itemId: a.item.id, variantId: a.item.variants[0].id, qty: 5}, // over stock (2)
                    {itemId: b.item.id, variantId: b.item.variants[0].id, qty: 2},
                    {itemId: "ghost", qty: 1},
                ],
            },
            host,
        );
        const lineA = preview.lines.find((l: { name: string }) => l.name === "A");
        expect(lineA.adjusted).toBe(true);
        expect(lineA.available).toBe(2);
        expect(lineA.lineTotal).toBe(20); // capped at 2 × $10
        expect(preview.lines.some((l: { removed?: boolean }) => l.removed)).toBe(true);
        expect(preview.subtotal).toBe(30); // 20 (A capped) + 10 (B 2×$5)
        expect(preview.totalLabel).toContain("30");
    });

    it("checks the cart out into a real storefront order and decrements stock", async () => {
        const host = makeHost();
        const a = await inventory.saveItem({item: {name: "A", price: 10, stock: 5, published: true}}, host);
        const res = await inventory.checkout(
            {
                items: [{itemId: a.item.id, variantId: a.item.variants[0].id, qty: 2}],
                customer: {name: "Sam", email: "s@x.y"}
            },
            host,
        );
        expect(res.ok).toBe(true);
        expect(res.orderNumber).toBeGreaterThanOrEqual(1000);
        expect((await inventory.getItem({id: a.item.id}, host)).item.variants[0].stock).toBe(3);
        const orders = await inventory.listOrders({}, host);
        expect(orders.orders).toHaveLength(1);
        expect(orders.orders[0].source).toBe("storefront");
    });

    it("rejects checkout without customer details", async () => {
        const host = makeHost();
        const a = await inventory.saveItem({item: {name: "A", price: 10, stock: 5, published: true}}, host);
        await expect(
            inventory.checkout({
                items: [{itemId: a.item.id, variantId: a.item.variants[0].id, qty: 1}],
                customer: {}
            }, host),
        ).rejects.toThrow(/required/i);
    });

    it("links an order to a GDPR subject via a lowercased subjectRef", async () => {
        const host = makeHost();
        const a = await inventory.saveItem({item: {name: "A", price: 10, stock: 5, published: true}}, host);
        await inventory.checkout(
            {
                items: [{itemId: a.item.id, variantId: a.item.variants[0].id, qty: 1}],
                customer: {name: "Sam", email: "Sam@Example.COM"}
            },
            host,
        );
        const {orders} = await inventory.listOrders({}, host);
        // The GDPR service matches a flat field, so the order carries the email at top level.
        expect(orders[0].subjectRef).toBe("sam@example.com");
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
