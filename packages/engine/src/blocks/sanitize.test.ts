import { describe, it, expect } from "vitest";
import { FALLBACK_BLOCK_TYPE, createBlockRegistry, sanitizeBlocks } from "@pressh/engine";
import type { BlockNode } from "@pressh/engine";

const NO_CAPS = { capabilities: [] as string[] };
const RAW_CAPS = { capabilities: ["content.rawhtml"] };

function rawHtml(content: string): string {
  const registry = createBlockRegistry();
  const out = sanitizeBlocks(registry, [{ type: "html", content }], RAW_CAPS);
  return out[0]?.content ?? "";
}

describe("sanitizeBlocks — XSS corpus", () => {
  it("strips <script> from text blocks", () => {
    const registry = createBlockRegistry();
    const out = sanitizeBlocks(
      registry,
      [{ type: "paragraph", content: "hello<script>alert(1)</script>" }],
      NO_CAPS,
    );
    expect(out[0]?.content).toBe("hello");
  });

  it("strips event handlers and javascript: URLs in raw HTML", () => {
    const corpus = [
      `<img src=x onerror=alert(1)>`,
      `<a href="javascript:alert(1)">x</a>`,
      `<script>alert(1)</script>`,
      `<div onclick="evil()">y</div>`,
    ];
    for (const payload of corpus) {
      const cleaned = rawHtml(payload);
      expect(cleaned.toLowerCase()).not.toContain("onerror");
      expect(cleaned.toLowerCase()).not.toContain("onclick");
      expect(cleaned.toLowerCase()).not.toContain("javascript:");
      expect(cleaned.toLowerCase()).not.toContain("<script");
    }
  });

  it("forces sandbox onto iframes in raw HTML", () => {
    const cleaned = rawHtml(`<iframe src="https://example.com"></iframe>`);
    expect(cleaned).toContain("sandbox");
  });

    it("allows an https iframe but strips the src of an http or protocol-relative one", () => {
        expect(rawHtml(`<iframe src="https://www.youtube.com/embed/x"></iframe>`)).toContain(
            "https://www.youtube.com/embed/x",
        );
        // http downgrade and protocol-relative hosts must not survive as a src.
        expect(rawHtml(`<iframe src="http://evil.com/x"></iframe>`)).not.toContain("evil.com");
        expect(rawHtml(`<iframe src="//evil.com/x"></iframe>`)).not.toContain("evil.com");
    });

  it("drops unsafe image src", () => {
    const registry = createBlockRegistry();
    const out = sanitizeBlocks(
      registry,
      [{ type: "image", props: { src: "javascript:alert(1)", alt: "x" } }],
      NO_CAPS,
    );
    expect(out[0]?.props?.["src"]).toBe("");
  });
});

describe("sanitizeBlocks — capability gating", () => {
  it("rejects a raw-HTML block without content.rawhtml", () => {
    const registry = createBlockRegistry();
    expect(() =>
      sanitizeBlocks(registry, [{ type: "html", content: "<p>x</p>" }], NO_CAPS),
    ).toThrowError(/capability/i);
  });

  it("allows a raw-HTML block with the capability", () => {
    expect(() => rawHtml("<p>ok</p>")).not.toThrow();
  });
});

describe("sanitizeBlocks — fallbacks", () => {
  it("replaces unknown blocks with a safe fallback", () => {
    const registry = createBlockRegistry();
    const out = sanitizeBlocks(registry, [{ type: "mystery", content: "<script>x</script>" }], NO_CAPS);
    expect(out[0]?.type).toBe(FALLBACK_BLOCK_TYPE);
    expect(out[0]?.content).toBeUndefined();
  });

  it("replaces disabled blocks with a fallback", () => {
    const registry = createBlockRegistry();
    registry.disable("paragraph");
    const out = sanitizeBlocks(registry, [{ type: "paragraph", content: "hi" }], NO_CAPS);
    expect(out[0]?.type).toBe(FALLBACK_BLOCK_TYPE);
  });

  it("replaces malformed entries with a fallback", () => {
    const registry = createBlockRegistry();
    const out = sanitizeBlocks(registry, [null, 42, { noType: true }] as unknown[], NO_CAPS);
    expect(out.every((b: BlockNode) => b.type === FALLBACK_BLOCK_TYPE)).toBe(true);
  });

  it("sanitizes nested children recursively", () => {
    const registry = createBlockRegistry();
    const out = sanitizeBlocks(
      registry,
      [{ type: "quote", content: "q", children: [{ type: "paragraph", content: "x<script>y</script>" }] }],
      NO_CAPS,
    );
    expect(out[0]?.children?.[0]?.content).toBe("x");
  });
});
