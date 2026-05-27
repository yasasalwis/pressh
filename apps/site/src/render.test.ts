import {describe, expect, it} from "vitest";
import {createElement} from "react";
import {renderToString} from "react-dom/server";
import type {BlockNode} from "@pressh/engine";
import {Blocks} from "./components/Blocks.js";
import {renderNotFound, renderPage, renderServerError} from "./render.js";

function render(blocks: BlockNode[]): string {
    return renderToString(createElement(Blocks, {blocks}));
}

describe("Blocks", () => {
  it("renders a paragraph (sanitized HTML passes through)", () => {
      expect(render([{type: "paragraph", content: "<b>hi</b>"}])).toBe("<p><b>hi</b></p>");
  });

    it("clamps heading levels to h1-h6", () => {
        expect(render([{type: "heading", props: {level: 9}, content: "T"}])).toBe("<h6>T</h6>");
  });

  it("escapes code content", () => {
      expect(render([{type: "code", content: "<b>x</b>"}])).toBe(
      "<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>",
    );
  });

  it("renders an image only with a src and escapes attributes", () => {
      expect(render([{type: "image", props: {src: "/a.png", alt: '"q"'}}])).toContain('src="/a.png"');
      expect(render([{type: "image", props: {}}])).toBe("");
  });

    it("ignores unsupported blocks", () => {
        expect(render([{type: "mystery"}])).toBe("");
    });

    it("recurses into children", () => {
    const blocks: BlockNode[] = [
      { type: "paragraph", content: "a" },
      { type: "quote", content: "q", children: [{ type: "paragraph", content: "b" }] },
    ];
        const html = render(blocks);
    expect(html).toContain("<p>a</p>");
    expect(html).toContain("<blockquote>q</blockquote>");
    expect(html).toContain("<p>b</p>");
  });
});

describe("document renderers", () => {
    it("wraps a body in a full HTML document and escapes the title", () => {
        const html = renderPage({title: "A & B <x>", body: "<main>hi</main>"});
        expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
        expect(html).toContain("<main>hi</main>");
        expect(html).toContain("A &amp; B &lt;x&gt;");
    });

    it("renders the 404 and 500 fallback pages", () => {
        expect(renderNotFound()).toContain("404 — Not found");
        expect(renderServerError()).toContain("500 — Server error");
    });
});
