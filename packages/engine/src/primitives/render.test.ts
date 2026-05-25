import {describe, expect, it} from "vitest";
import {renderTree} from "./render.js";
import type {PrimitiveNode, PrimitiveRenderContext} from "./types.js";

const emptyCtx: PrimitiveRenderContext = { listPublished: async () => [] };

describe("renderTree — basic primitives", () => {
  it("renders nested layout with classes and a stylesheet", async () => {
    const tree: PrimitiveNode[] = [
      {
        id: "sec1",
        type: "section",
        children: [
          { id: "c1", type: "container", children: [{ id: "h1", type: "heading", props: { text: "Hi", level: 1 } }] },
        ],
      },
    ];
    const { html, css } = await renderTree(tree, emptyCtx);
    expect(html).toContain('<section class="pst-section psn-sec1">');
    expect(html).toContain('<div class="pst-container psn-c1">');
    expect(html).toContain('<h1 class="pst-heading psn-h1">Hi</h1>');
    expect(css).toContain(".pst-section{");
  });

  it("clamps heading level and escapes text", async () => {
    const { html } = await renderTree(
      [{ id: "h", type: "heading", props: { text: "<script>x</script>", level: 99 } }],
      emptyCtx,
    );
    expect(html).toContain("<h6");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>x</script>");
  });

  it("turns newlines into <br> in text", async () => {
    const { html } = await renderTree([{ id: "t", type: "text", props: { text: "a\nb" } }], emptyCtx);
    expect(html).toContain("a<br>b");
  });

  it("renders a known icon and drops an unknown one", async () => {
    const ok = await renderTree([{ id: "i", type: "icon", props: { name: "check" } }], emptyCtx);
    expect(ok.html).toContain("<svg");
    expect(ok.html).toContain("currentColor");
    const bad = await renderTree([{ id: "i", type: "icon", props: { name: "nope" } }], emptyCtx);
    expect(bad.html).not.toContain("<svg");
  });
});

describe("renderTree — URL sink hardening", () => {
  it("neutralises a javascript: button href", async () => {
    const { html } = await renderTree(
      [{ id: "b", type: "button", props: { label: "Go", href: "javascript:alert(1)" } }],
      emptyCtx,
    );
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html).toContain('href=""');
  });

  it("drops an unsafe image src entirely", async () => {
    const { html } = await renderTree(
      [{ id: "img", type: "image", props: { src: "javascript:alert(1)", alt: "x" } }],
      emptyCtx,
    );
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html).not.toContain("<img");
  });

  it("only allows https iframe srcs in video", async () => {
    const httpsOk = await renderTree([{ id: "v", type: "video", props: { url: "https://x.com/e" } }], emptyCtx);
    expect(httpsOk.html).toContain("<iframe");
    const httpDropped = await renderTree([{ id: "v", type: "video", props: { url: "http://x.com/e" } }], emptyCtx);
    expect(httpDropped.html).not.toContain("<iframe");
    const jsDropped = await renderTree([{ id: "v", type: "video", props: { url: "javascript:alert(1)" } }], emptyCtx);
    expect(jsDropped.html.toLowerCase()).not.toContain("javascript:");
  });

  it("never emits inline style or event-handler attributes", async () => {
    const tree: PrimitiveNode[] = [
      {
        id: "f",
        type: "form",
        props: { action: "/submit" },
        styles: { base: { default: { background: "#fff", color: "#000" } } },
        children: [
          { id: "in", type: "input", props: { name: "email", label: "Email", inputType: "email" } },
          { id: "ta", type: "textarea", props: { name: "msg", label: "Message" } },
          { id: "sb", type: "submit", props: { label: "Send" } },
        ],
      },
    ];
    const { html } = await renderTree(tree, emptyCtx);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).toContain('<form class="pst-form psn-f" method="post" action="/submit">');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="submit"');
  });
});

describe("renderTree — editor mode", () => {
  it("adds data-nid to every element and placeholders for empty containers", async () => {
    const tree: PrimitiveNode[] = [{ id: "sec", type: "section", children: [] }];
    const { html } = await renderTree(tree, emptyCtx, { editor: true });
    expect(html).toContain('data-nid="sec"');
    expect(html).toContain("ps-editor-empty");
  });

  it("omits data-nid and placeholders in normal (site) mode", async () => {
    const tree: PrimitiveNode[] = [{ id: "sec", type: "section", children: [] }];
    const { html } = await renderTree(tree, emptyCtx);
    expect(html).not.toContain("data-nid");
    expect(html).not.toContain("ps-editor-empty");
    expect(html).toBe('<section class="pst-section psn-sec"></section>');
  });

  it("renders the collection template once (no item data) while editing", async () => {
    const tree: PrimitiveNode[] = [
      { id: "cl", type: "collectionList", children: [{ id: "card", type: "heading", bindings: { text: { field: "title" } } }] },
    ];
    const { html } = await renderTree(tree, emptyCtx, { editor: true });
    expect(html).toContain('data-nid="card"');
  });
});

describe("renderTree — collection list + bindings", () => {
  const ctx: PrimitiveRenderContext = {
    listPublished: async () => [
      { title: "First Post", slug: "first" },
      { title: "Second Post", slug: "second" },
    ],
  };

  const tree: PrimitiveNode[] = [
    {
      id: "cl",
      type: "collectionList",
      props: { limit: 5 },
      children: [
        {
          id: "card",
          type: "column",
          children: [
            { id: "t", type: "heading", props: { level: 3 }, bindings: { text: { field: "title" } } },
            { id: "lnk", type: "button", props: { label: "Read" }, bindings: { href: { field: "slug", as: "url" } } },
          ],
        },
      ],
    },
  ];

  it("repeats the template per item and resolves bound fields", async () => {
    const { html } = await renderTree(tree, ctx);
    expect(html).toContain("First Post");
    expect(html).toContain("Second Post");
    expect(html).toContain('href="first"');
    expect(html).toContain('href="second"');
    // template child class appears once per item
    expect(html.split("psn-card").length - 1).toBe(2);
  });

  it("emits the template node's CSS only once", async () => {
    const styled: PrimitiveNode[] = [
      {
        id: "cl2",
        type: "collectionList",
        children: [{ id: "card2", type: "column", styles: { base: { default: { gap: "2rem" } } } }],
      },
    ];
    const { css } = await renderTree(styled, ctx);
    expect(css.split(".psn-card2{").length - 1).toBe(1);
  });

  it("shows the empty state when there are no items", async () => {
    const { html } = await renderTree(
      [{ id: "cl3", type: "collectionList", props: { emptyText: "No posts yet" }, children: [] }],
      emptyCtx,
    );
    expect(html).toContain("No posts yet");
  });

    it("passes a `source` prop through to the render context query", async () => {
        let seen: { source?: string } | null = null;
        const ctx: PrimitiveRenderContext = {
            listPublished: async (q) => {
                seen = q;
                return [];
            },
        };
        await renderTree(
            [{id: "cl4", type: "collectionList", props: {source: "inventory:products", limit: 4}, children: []}],
            ctx,
        );
        expect(seen?.source).toBe("inventory:products");
    });
});

describe("renderTree — commerce primitives", () => {
    it("renders an add-to-cart button with the product id bound from the item scope", async () => {
        const ctx: PrimitiveRenderContext = {
            listPublished: async () => [{id: "prod-1", name: "Mug", priceLabel: "$9.50"}],
        };
        const tree: PrimitiveNode[] = [
            {
                id: "cl",
                type: "collectionList",
                props: {source: "inventory:products"},
                children: [
                    {
                        id: "card",
                        type: "column",
                        children: [
                            {
                                id: "atc",
                                type: "addToCart",
                                props: {label: "Add to cart"},
                                bindings: {productId: {field: "id"}}
                            },
                        ],
                    },
                ],
            },
        ];
        const {html} = await renderTree(tree, ctx);
        expect(html).toContain('data-ps-add="prod-1"');
        expect(html).toContain('type="button"');
        expect(html).toContain("Add to cart");
        expect(html).not.toMatch(/\son[a-z]+=/i); // no event handlers
        expect(html).not.toMatch(/\sstyle=/);
    });

    it("renders cart, cart-button and checkout commerce placeholders", async () => {
        const {html} = await renderTree(
            [
                {id: "cart", type: "commerce", props: {view: "cart"}},
                {id: "btn", type: "commerce", props: {view: "cartButton", label: "Bag"}},
                {id: "co", type: "commerce", props: {view: "checkout"}},
            ],
            emptyCtx,
        );
        expect(html).toContain('data-ps-commerce="cart"');
        expect(html).toContain('data-ps-commerce="cartButton"');
        expect(html).toContain('data-ps-commerce="checkout"');
        expect(html).toContain("data-ps-cart-count");
        expect(html).toContain("Bag");
    });

    it("escapes a malicious product id in the add-to-cart attribute", async () => {
        const {html} = await renderTree(
            [{id: "atc", type: "addToCart", props: {label: "x", productId: '"><img src=x onerror=alert(1)>'}}],
            emptyCtx,
        );
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&quot;&gt;&lt;img");
    });
});
