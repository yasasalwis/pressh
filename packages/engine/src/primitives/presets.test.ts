import { describe, it, expect } from "vitest";
import { PRESETS, cloneWithNewIds, instantiatePreset } from "./presets.js";
import { PRIMITIVE_DEFS, getPrimitiveDef } from "./defs.js";
import { renderTree } from "./render.js";
import type { PrimitiveNode, PrimitiveRenderContext, PrimitiveType } from "./types.js";

function collectIds(nodes: PrimitiveNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.id);
    if (n.children) collectIds(n.children, out);
  }
  return out;
}
function collectTypes(nodes: PrimitiveNode[], out: Set<PrimitiveType> = new Set()): Set<PrimitiveType> {
  for (const n of nodes) {
    out.add(n.type);
    if (n.children) collectTypes(n.children, out);
  }
  return out;
}

function counter() {
  let i = 0;
  return () => "id" + (i++).toString(36);
}

const ctx: PrimitiveRenderContext = {
  listPublished: async () => [
    { title: "Hello World", slug: "hello-world", publishedAt: "2026-05-01" },
    { title: "Second Post", slug: "second", publishedAt: "2026-04-01" },
  ],
};

describe("primitive defs", () => {
  it("provides metadata for every primitive type used in presets", () => {
    const used = new Set<PrimitiveType>();
    for (const p of PRESETS) collectTypes(p.template, used);
    for (const type of used) {
      expect(getPrimitiveDef(type), `missing PrimitiveDef for ${type}`).toBeDefined();
    }
  });

  it("marks containers correctly", () => {
    expect(getPrimitiveDef("section")?.isContainer).toBe(true);
    expect(getPrimitiveDef("heading")?.isContainer).toBe(false);
    expect(PRIMITIVE_DEFS.length).toBeGreaterThanOrEqual(18);
  });
});

describe("cloneWithNewIds", () => {
  it("assigns a unique fresh id to every node and preserves structure", () => {
    const tree: PrimitiveNode[] = [
      { id: "a", type: "section", props: { x: 1 }, children: [{ id: "b", type: "heading", bindings: { text: { field: "title" } } }] },
    ];
    const cloned = cloneWithNewIds(tree, counter());
    const ids = collectIds(cloned);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cloned[0]?.id).not.toBe("a");
    expect(cloned[0]?.props).toEqual({ x: 1 });
    expect(cloned[0]?.children?.[0]?.bindings).toEqual({ text: { field: "title" } });
  });

  it("does not mutate the source template", () => {
    const tree: PrimitiveNode[] = [{ id: "a", type: "section", children: [{ id: "b", type: "text" }] }];
    cloneWithNewIds(tree, counter());
    expect(tree[0]?.id).toBe("a");
    expect(tree[0]?.children?.[0]?.id).toBe("b");
  });
});

describe("every preset instantiates and renders", () => {
  for (const preset of PRESETS) {
    it(`renders "${preset.id}" with unique ids and no unknown primitives`, async () => {
      const nodes = instantiatePreset(preset, counter());
      const ids = collectIds(nodes);
      expect(new Set(ids).size, "ids must be unique").toBe(ids.length);

      const { html, css } = await renderTree(nodes, ctx);
      expect(html.length).toBeGreaterThan(0);
      expect(html).not.toContain("unknown primitive");
      expect(css.length).toBeGreaterThan(0);
      // no inline styles or event handlers leak through
      expect(html).not.toMatch(/\sstyle=/);
      expect(html).not.toMatch(/\son[a-z]+=/i);
      // no token references leaked literally into output
      expect(html).not.toContain("token:");
    });
  }
});

describe("recent-posts binds to live content", () => {
  it("repeats the card per published item and resolves title/slug bindings", async () => {
    const preset = PRESETS.find((p) => p.id === "recent-posts");
    expect(preset).toBeDefined();
    const { html } = await renderTree(instantiatePreset(preset!, counter()), ctx);
    expect(html).toContain("Hello World");
    expect(html).toContain("Second Post");
    expect(html).toContain('href="hello-world"');
    expect(html).toContain('href="second"');
  });
});

describe("contact-form decomposes to form primitives", () => {
  it("renders a real form with inputs and a submit", async () => {
    const preset = PRESETS.find((p) => p.id === "contact-form");
    const { html } = await renderTree(instantiatePreset(preset!, counter()), ctx);
    expect(html).toContain('<form class="pst-form');
    expect(html).toContain('method="post"');
    expect(html).toContain('type="email"');
    expect(html).toContain("<textarea");
    expect(html).toContain('type="submit"');
  });
});
