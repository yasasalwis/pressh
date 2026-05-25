import {describe, expect, it} from "vitest";
import {compileDeclarations, compileNodeCss, compileTreeCss, cssId} from "./css.js";
import type {PrimitiveNode, StyleProps} from "./types.js";

describe("compileDeclarations — valid values", () => {
  it("emits whitelisted declarations", () => {
    const sp: StyleProps = {
      display: "flex",
      paddingTop: "1.5rem",
      color: "#ff8800",
      fontWeight: "700",
      textAlign: "center",
      gap: "2rem",
    };
    const css = compileDeclarations(sp);
    expect(css).toContain("display:flex");
    expect(css).toContain("padding-top:1.5rem");
    expect(css).toContain("color:#ff8800");
    expect(css).toContain("font-weight:700");
    expect(css).toContain("text-align:center");
    expect(css).toContain("gap:2rem");
  });

  it("emits size declarations including height and max-height", () => {
    const css = compileDeclarations({
      width: "320px",
      maxWidth: "100%",
      height: "480px",
      minHeight: "240px",
      maxHeight: "640px",
    });
    expect(css).toContain("width:320px");
    expect(css).toContain("max-width:100%");
    expect(css).toContain("height:480px");
    expect(css).toContain("min-height:240px");
    expect(css).toContain("max-height:640px");
  });

  it("resolves token references to CSS vars", () => {
    expect(compileDeclarations({ color: "token:colorPrimary" })).toBe("color:var(--colorPrimary)");
    expect(compileDeclarations({ background: "token:colorBackground" })).toBe(
      "background:var(--colorBackground)",
    );
  });

  it("validates rgb/rgba and hsl colors", () => {
    expect(compileDeclarations({ color: "rgb(10, 20, 30)" })).toBe("color:rgb(10, 20, 30)");
    expect(compileDeclarations({ color: "rgba(10,20,30,0.5)" })).toBe("color:rgba(10,20,30,0.5)");
  });

  it("validates a box-shadow and grid template", () => {
    expect(compileDeclarations({ boxShadow: "0 4px 12px #00000022" })).toContain("box-shadow:");
    expect(compileDeclarations({ gridTemplateColumns: "repeat(3,1fr)" })).toBe(
      "grid-template-columns:repeat(3,1fr)",
    );
  });

  it("wraps a safe background image URL", () => {
    expect(compileDeclarations({ backgroundImage: "https://cdn.example.com/a.png" })).toBe(
      'background-image:url("https://cdn.example.com/a.png")',
    );
  });
});

describe("compileDeclarations — rejects unsafe / malformed values", () => {
  it("drops CSS-injection attempts that close the declaration", () => {
    expect(compileDeclarations({ color: "red;} body{display:none}" } as StyleProps)).toBe("");
    expect(compileDeclarations({ color: "#fff;background:url(x)" } as StyleProps)).toBe("");
    expect(compileDeclarations({ width: "100px}</style><script>" } as StyleProps)).toBe("");
  });

  it("drops expression() and javascript-bearing values", () => {
    expect(compileDeclarations({ width: "expression(alert(1))" } as StyleProps)).toBe("");
    expect(compileDeclarations({ backgroundImage: "javascript:alert(1)" })).toBe("");
    expect(compileDeclarations({ backgroundImage: "url(x);background:red" })).toBe("");
  });

  it("drops unknown enum values and malformed sizes", () => {
    expect(compileDeclarations({ display: "evil" } as StyleProps)).toBe("");
    expect(compileDeclarations({ paddingTop: "10potato" } as StyleProps)).toBe("");
    expect(compileDeclarations({ textAlign: "center; color:red" } as StyleProps)).toBe("");
  });

  it("ignores keys outside the whitelist", () => {
    expect(compileDeclarations({ behavior: "url(x)", color: "#000" } as unknown as StyleProps)).toBe(
      "color:#000",
    );
  });
});

describe("cssId", () => {
  it("strips characters that are unsafe in a class name", () => {
    expect(cssId("abc123_-")).toBe("abc123_-");
    expect(cssId("a b{}.c")).toBe("abc");
  });
});

describe("compileNodeCss — breakpoints and states", () => {
  it("emits base, hover, and media-queried rules", () => {
    const node: PrimitiveNode = {
      id: "n1",
      type: "button",
      styles: {
        base: { default: { color: "#fff" }, hover: { color: "#eee" } },
        mobile: { default: { fontSize: "0.9rem" } },
      },
    };
    const css = compileNodeCss(node);
    expect(css).toContain(".psn-n1.psn-n1{color:#fff}");
    expect(css).toContain(".psn-n1.psn-n1:hover{color:#eee}");
    expect(css).toContain("@media(max-width:480px){.psn-n1.psn-n1{font-size:0.9rem}}");
  });
});

describe("compileNodeCss — auto-responsive grid collapse", () => {
  it("collapses a 4-col grid to 2 on tablet and 1 on mobile", () => {
    const node: PrimitiveNode = {
      id: "g",
      type: "grid",
      styles: { base: { default: { gridTemplateColumns: "repeat(4,1fr)" } } },
    };
    const css = compileNodeCss(node);
    expect(css).toContain(".psn-g.psn-g{grid-template-columns:repeat(4,1fr)}");
    expect(css).toContain("@media(max-width:768px){.psn-g.psn-g{grid-template-columns:repeat(2,1fr)}}");
    expect(css).toContain("@media(max-width:480px){.psn-g.psn-g{grid-template-columns:1fr}}");
  });

  it("collapses the default grid even when the node sets no columns", () => {
    const css = compileNodeCss({ id: "g2", type: "grid" });
    expect(css).toContain("@media(max-width:768px){.psn-g2.psn-g2{grid-template-columns:repeat(2,1fr)}}");
    expect(css).toContain("@media(max-width:480px){.psn-g2.psn-g2{grid-template-columns:1fr}}");
  });

  it("stacks a 2-col grid on mobile but keeps it on tablet", () => {
    const css = compileNodeCss({
      id: "g3",
      type: "grid",
      styles: { base: { default: { gridTemplateColumns: "repeat(2,1fr)" } } },
    });
    expect(css).toContain("@media(max-width:480px){.psn-g3.psn-g3{grid-template-columns:1fr}}");
    expect(css).not.toContain("max-width:768px");
  });

  it("does not synthesize for non-grid primitives", () => {
    const css = compileNodeCss({
      id: "c",
      type: "column",
      styles: { base: { default: { gap: "1rem" } } },
    });
    expect(css).not.toContain("grid-template-columns");
  });
});

describe("compileNodeCss — manual override always wins", () => {
  it("keeps the designer's mobile column count instead of collapsing to 1fr", () => {
    const node: PrimitiveNode = {
      id: "g",
      type: "grid",
      styles: {
        base: { default: { gridTemplateColumns: "repeat(4,1fr)" } },
        mobile: { default: { gridTemplateColumns: "repeat(2,1fr)" } },
      },
    };
    const css = compileNodeCss(node);
    expect(css).toContain("@media(max-width:480px){.psn-g.psn-g{grid-template-columns:repeat(2,1fr)}}");
    expect(css).not.toContain("grid-template-columns:1fr}");
    // tablet gap is still auto-filled because the designer left it unset
    expect(css).toContain("@media(max-width:768px){.psn-g.psn-g{grid-template-columns:repeat(2,1fr)}}");
  });
});

describe("compileNodeCss — column width beats row flex distribution", () => {
  it("doubles the class and opts a width-bearing column out of flex", () => {
    const css = compileNodeCss({
      id: "c1",
      type: "column",
      styles: { base: { default: { width: "300px" } } },
    });
    // doubled class (0,2,0) out-specifies `.pst-row>.pst-column` (0,2,0) on source order
    expect(css).toContain(".psn-c1.psn-c1{width:300px;flex:0 0 auto}");
  });

  it("does not opt out when only max-width is set (flex distribution still applies)", () => {
    const css = compileNodeCss({
      id: "c2",
      type: "column",
      styles: { base: { default: { maxWidth: "300px" } } },
    });
    expect(css).toContain(".psn-c2.psn-c2{max-width:300px}");
    expect(css).not.toContain("flex:0 0 auto");
  });

  it("only applies the flex opt-out to columns, not other primitives in a row", () => {
    const css = compileNodeCss({
      id: "i1",
      type: "image",
      styles: { base: { default: { width: "50%" } } },
    });
    expect(css).toContain(".psn-i1.psn-i1{width:50%}");
    expect(css).not.toContain("flex:0 0 auto");
  });

  // The structural column-flex default must be zero-specificity `:where()` so a
  // modified column survives the page's own stylesheet re-emitting it later in
  // the document ("modified column values not reflected on the published site").
  it("emits the column-flex default as :where so a per-node width survives a later stylesheet", () => {
    const css = compileTreeCss([
      {
        id: "row",
        type: "container",
        children: [
          { id: "c1", type: "column", styles: { base: { default: { width: "120px" } } }, children: [] },
          { id: "c2", type: "column", children: [] },
        ],
      },
    ]);
    expect(css).toContain(":where(.pst-row>.pst-column,.ps-flow-row>.pst-column){flex:1 1 220px}");
    expect(css).toContain(".psn-c1.psn-c1{width:120px;flex:0 0 auto}");
  });
});

describe("compileNodeCss — children fill an explicit parent height", () => {
  it("flexes a fixed-height container and grows its layout children", () => {
    const css = compileNodeCss({
      id: "wrap",
      type: "container",
      styles: { base: { default: { height: "300px" } } },
      children: [{ id: "inner", type: "container", children: [] }],
    });
    expect(css).toContain(".psn-wrap.psn-wrap{display:flex;flex-direction:column}");
    expect(css).toContain(".psn-wrap.psn-wrap>:where(.pst-section,.pst-container,.pst-row,.pst-column,.pst-grid){flex:1 1 auto;min-height:0}");
  });

  it("treats min-height the same as height", () => {
    const css = compileNodeCss({
      id: "w2",
      type: "container",
      styles: { base: { default: { minHeight: "240px" } } },
      children: [{ id: "i2", type: "container", children: [] }],
    });
    expect(css).toContain(".psn-w2.psn-w2{display:flex;flex-direction:column}");
  });

  it("does not re-flex a column (already a flex column) but still grows its children", () => {
    const css = compileNodeCss({
      id: "col",
      type: "column",
      styles: { base: { default: { height: "300px" } } },
      children: [{ id: "ci", type: "container", children: [] }],
    });
    expect(css).not.toContain(".psn-col.psn-col{display:flex");
    expect(css).toContain(".psn-col.psn-col>:where(.pst-section,.pst-container,.pst-row,.pst-column,.pst-grid){flex:1 1 auto;min-height:0}");
  });

  it("skips the fill when children are a column-flow row (they already stretch)", () => {
    const css = compileNodeCss({
      id: "row",
      type: "container",
      styles: { base: { default: { height: "80px" } } },
      children: [
        { id: "a", type: "column", children: [] },
        { id: "b", type: "column", children: [] },
      ],
    });
    expect(css).not.toContain("flex:1 1 auto");
    expect(css).not.toContain(".psn-row.psn-row{display:flex");
  });

  it("does not fill when the container has no explicit height", () => {
    const css = compileNodeCss({
      id: "plain",
      type: "container",
      styles: { base: { default: { background: "#fff" } } },
      children: [{ id: "x", type: "container", children: [] }],
    });
    expect(css).not.toContain("flex:1 1 auto");
  });

  it("respects a designer-set display/direction instead of forcing flex-column", () => {
    const css = compileNodeCss({
      id: "grid",
      type: "container",
      styles: { base: { default: { height: "300px", display: "grid" } } },
      children: [{ id: "g", type: "container", children: [] }],
    });
    expect(css).toContain("display:grid");
    expect(css).not.toContain("flex:1 1 auto");
    expect(css).not.toContain("flex-direction:column");
  });
});

describe("compileNodeCss — fluid typography", () => {
  it("turns a large base font-size into a clamp that tops out at the set value", () => {
    const css = compileNodeCss({
      id: "h",
      type: "heading",
      styles: { base: { default: { fontSize: "2.5rem" } } },
    });
    expect(css).toMatch(/\.psn-h\.psn-h\{font-size:clamp\([^)]*rem, calc\([^)]+\), 2\.5rem\)\}/);
  });

  it("leaves small body text fixed", () => {
    const css = compileNodeCss({
      id: "t",
      type: "text",
      styles: { base: { default: { fontSize: "1rem" } } },
    });
    expect(css).toContain(".psn-t.psn-t{font-size:1rem}");
    expect(css).not.toContain("clamp(");
  });

  it("does not auto-scale when the designer manages type per breakpoint", () => {
    const css = compileNodeCss({
      id: "h2",
      type: "heading",
      styles: {
        base: { default: { fontSize: "3rem" } },
        mobile: { default: { fontSize: "1.5rem" } },
      },
    });
    expect(css).toContain(".psn-h2.psn-h2{font-size:3rem}");
    expect(css).not.toContain("clamp(");
    expect(css).toContain("@media(max-width:480px){.psn-h2.psn-h2{font-size:1.5rem}}");
  });
});

describe("compileDeclarations — fluid clamp surface", () => {
  it("accepts the strict synthesized clamp form", () => {
    expect(compileDeclarations({ fontSize: "clamp(1.563rem, calc(1.705vw + 1.222rem), 2.5rem)" })).toBe(
      "font-size:clamp(1.563rem, calc(1.705vw + 1.222rem), 2.5rem)",
    );
  });

  it("rejects arbitrary or malicious clamp input", () => {
    expect(compileDeclarations({ fontSize: "clamp(1rem, evil, 2rem)" } as StyleProps)).toBe("");
    expect(compileDeclarations({ fontSize: "clamp(1rem;}body{x:1, calc(1vw + 1rem), 2rem)" } as StyleProps)).toBe("");
  });
});

describe("compileTreeCss — auto-responsive base rules", () => {
  const tree: PrimitiveNode[] = [
    {
      id: "sec",
      type: "section",
      children: [
        {
          id: "cont",
          type: "container",
          children: [
            { id: "c1", type: "column", children: [] },
            { id: "c2", type: "column", children: [] },
          ],
        },
      ],
    },
  ];

  it("stacks flow-rows on mobile and never injects container padding", () => {
    const css = compileTreeCss(tree);
    expect(css).toContain("@media(max-width:480px){");
    expect(css).toContain(".ps-flow-row{flex-direction:column}");
    // Layout primitives add zero spacing by default — no auto container gutter.
    expect(css).not.toContain("padding-left:1.1rem");
  });

  it("gives columns an intrinsic flex-basis so they wrap when narrow", () => {
    expect(compileTreeCss(tree)).toContain("flex:1 1 220px");
  });

  it("emits the mobile rules in the base block, before per-node rules win", () => {
    const withOverride: PrimitiveNode[] = [
      {
        id: "r",
        type: "row",
        styles: { mobile: { default: { flexDirection: "row" } } },
        children: [],
      },
    ];
    const css = compileTreeCss(withOverride);
    const baseStack = css.indexOf(".pst-row{flex-direction:column}");
    const nodeOverride = css.indexOf(".psn-r.psn-r{flex-direction:row}");
    expect(baseStack).toBeGreaterThanOrEqual(0);
    expect(nodeOverride).toBeGreaterThanOrEqual(0);
    expect(nodeOverride).toBeGreaterThan(baseStack);
  });
});

describe("compileTreeCss — determinism and base rules", () => {
  const tree: PrimitiveNode[] = [
    {
      id: "sec",
      type: "section",
      children: [
        { id: "h", type: "heading", styles: { base: { default: { color: "#111" } } } },
        { id: "b", type: "button", styles: { base: { default: { background: "#6d28d9" } } } },
      ],
    },
  ];

  it("includes base type rules for present types", () => {
    const css = compileTreeCss(tree);
    expect(css).toContain(".pst-section{");
    expect(css).toContain(".pst-heading{");
    expect(css).toContain(".pst-button{");
  });

  it("is deterministic across runs", () => {
    expect(compileTreeCss(tree)).toBe(compileTreeCss(tree));
  });

  // A header/footer fragment and the page are injected as separate <style>
  // blocks. The per-node rule doubles its class (0,2,0) so it outranks the
  // page's later, single-class `.pst-container` default (0,1,0) — it can't be
  // clobbered by source order across stylesheets ("header not full width on
  // other pages"), while the default still stays a class so it beats the theme.
  it("doubles per-node class so an override survives a later base duplicate", () => {
    const header = compileTreeCss([
      { id: "hdr", type: "container", styles: { base: { default: { maxWidth: "100%" } } } },
    ]);
    expect(header).toContain(".pst-container{"); // single-class default (0,1,0)
    expect(header).toContain(".psn-hdr.psn-hdr{max-width:100%}"); // doubled override (0,2,0)
  });

  // The published page injects the theme's article typography (e.g.
  // `img{margin:2rem 0}`, `h2{margin-top:3rem}`) alongside the compiled tree
  // CSS. A single-class `.pst-*` default (0,1,0) must beat the theme's bare
  // element selectors (0,0,1) so that leak can't push a header logo/heading out
  // of place — a mismatch the studio canvas (theme CSS absent) never reveals.
  it("keeps type defaults single-class so they beat the theme's element selectors", () => {
    const css = compileTreeCss([
      { id: "img", type: "image", props: { src: "https://x/y.png" } },
      { id: "h", type: "heading", props: { text: "Hi", level: 2 } },
    ]);
    expect(css).toMatch(/(^|\n)\.pst-image\{[^}]*margin:0/); // not :where(...) → (0,1,0) > img (0,0,1)
    expect(css).toMatch(/(^|\n)\.pst-heading\{[^}]*margin:0/); // (0,1,0) > h2 (0,0,1)
  });
});
