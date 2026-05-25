import sanitizeHtml from "sanitize-html";
import type { BlockDefinition, BlockNode, BlockRegistry } from "./types.js";
import { safeUrl } from "../url.js";

const INLINE_TAGS = ["b", "i", "em", "strong", "u", "s", "a", "br", "span", "code"];

/** Strict allowlist for normal text blocks — inline formatting only. */
const STRICT: sanitizeHtml.IOptions = {
  allowedTags: INLINE_TAGS,
  allowedAttributes: { a: ["href", "title", "rel", "target"] },
  allowedSchemes: ["http", "https", "mailto"],
  disallowedTagsMode: "discard",
  transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true) },
};

/**
 * Broader allowlist for the capability-gated raw-HTML block. Even here we
 * deliberately strip <script> and on* handlers and force iframe sandboxing —
 * the capability is the gate, sanitization is defense-in-depth (baseline #4).
 */
const RICH: sanitizeHtml.IOptions = {
  allowedTags: [
    ...INLINE_TAGS,
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "pre", "hr",
    "img", "figure", "figcaption", "div",
    "table", "thead", "tbody", "tr", "td", "th",
    "iframe",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "width", "height", "loading"],
    iframe: ["src", "width", "height", "allow", "allowfullscreen", "sandbox", "title"],
    "*": ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
    // Embedded frames must be absolute HTTPS — no http downgrade and no
    // protocol-relative `//evil.com` (which inherits the page scheme). Combined
    // with the forced sandbox below, a rawhtml author can embed an https widget
    // but cannot point a scriptable frame at an arbitrary http origin.
    allowedSchemesByTag: {iframe: ["https"]},
    allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
    iframe: sanitizeHtml.simpleTransform(
      "iframe",
      // No `allow-same-origin`: combined with `allow-scripts` it lets a framed
      // document escape the sandbox and act with its own origin's privileges.
      { sandbox: "allow-scripts allow-popups" },
      true,
    ),
  },
};

function textOnly(value: unknown): string {
  return sanitizeHtml(String(value ?? ""), { allowedTags: [], allowedAttributes: {} });
}

function clampLevel(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.min(6, Math.max(1, Math.floor(n)));
}

/** The built-in block types shipped with the engine. */
export function builtinBlocks(): BlockDefinition[] {
  return [
    {
      type: "paragraph",
      sanitize: (b) => ({ type: "paragraph", content: sanitizeHtml(String(b.content ?? ""), STRICT) }),
    },
    {
      type: "quote",
      sanitize: (b) => ({ type: "quote", content: sanitizeHtml(String(b.content ?? ""), STRICT) }),
    },
    {
      type: "heading",
      sanitize: (b) => ({
        type: "heading",
        props: { level: clampLevel(b.props?.["level"]) },
        content: textOnly(b.content),
      }),
    },
    {
      type: "image",
      sanitize: (b) => ({
        type: "image",
        props: { src: safeUrl(b.props?.["src"]), alt: textOnly(b.props?.["alt"]) },
      }),
    },
    {
      type: "code",
      // Code is stored verbatim as text; the renderer is responsible for HTML
      // escaping it. We do not run it through the HTML sanitizer.
      sanitize: (b) => ({
        type: "code",
        props: { lang: textOnly(b.props?.["lang"]) },
        content: String(b.content ?? ""),
      }),
    },
    {
      type: "html",
      requiredCapability: "content.rawhtml",
      sanitize: (b) => ({ type: "html", content: sanitizeHtml(String(b.content ?? ""), RICH) }),
    },
    {
      type: "designer-layout",
      sanitize: (b) => ({
        type: "designer-layout",
        props: { nodes: Array.isArray(b.props?.["nodes"]) ? b.props["nodes"] : [] },
      }),
    },
  ];
}

class BlockRegistryImpl implements BlockRegistry {
  readonly #defs = new Map<string, BlockDefinition>();
  readonly #disabled = new Set<string>();

  register(def: BlockDefinition): void {
    this.#defs.set(def.type, def);
  }
  get(type: string): BlockDefinition | undefined {
    return this.#defs.get(type);
  }
  has(type: string): boolean {
    return this.#defs.has(type);
  }
  disable(type: string): void {
    this.#disabled.add(type);
  }
  enable(type: string): void {
    this.#disabled.delete(type);
  }
  isDisabled(type: string): boolean {
    return this.#disabled.has(type);
  }
}

export function createBlockRegistry(defs: BlockDefinition[] = builtinBlocks()): BlockRegistry {
  const registry = new BlockRegistryImpl();
  for (const def of defs) registry.register(def);
  return registry;
}

export type { BlockNode };
