import { describe, it, expect } from "vitest";
import { renderBlock, renderBlocks } from "./render";
import type { BlockNode } from "@pressh/engine";

describe("renderBlock", () => {
  it("renders a paragraph (sanitized HTML passes through)", () => {
    expect(renderBlock({ type: "paragraph", content: "<b>hi</b>" })).toBe("<p><b>hi</b></p>");
  });

  it("renders a clamped heading", () => {
    expect(renderBlock({ type: "heading", props: { level: 9 }, content: "T" })).toBe("<h6>T</h6>");
  });

  it("escapes code content", () => {
    expect(renderBlock({ type: "code", content: "<b>x</b>" })).toBe(
      "<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>",
    );
  });

  it("renders an image only with a src and escapes attributes", () => {
    expect(renderBlock({ type: "image", props: { src: "/a.png", alt: '"q"' } })).toContain(
      'src="/a.png"',
    );
    expect(renderBlock({ type: "image", props: {} })).toBe("");
  });

  it("renders unsupported blocks as an inert comment", () => {
    expect(renderBlock({ type: "mystery" })).toBe("<!-- unsupported block -->");
  });
});

describe("renderBlocks", () => {
  it("concatenates blocks and recurses children", () => {
    const blocks: BlockNode[] = [
      { type: "paragraph", content: "a" },
      { type: "quote", content: "q", children: [{ type: "paragraph", content: "b" }] },
    ];
    const html = renderBlocks(blocks);
    expect(html).toContain("<p>a</p>");
    expect(html).toContain("<blockquote>q</blockquote>");
    expect(html).toContain("<p>b</p>");
  });
});
