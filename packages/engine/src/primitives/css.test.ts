import { describe, it, expect } from "vitest";
import { compileDeclarations, compileNodeCss, compileTreeCss, cssId } from "./css.js";
import type { PrimitiveNode, StyleProps } from "./types.js";

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
    expect(css).toContain(".psn-n1{color:#fff}");
    expect(css).toContain(".psn-n1:hover{color:#eee}");
    expect(css).toContain("@media(max-width:480px){.psn-n1{font-size:0.9rem}}");
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
});
