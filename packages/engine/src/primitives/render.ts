/**
 * Primitive tree → HTML renderer.
 *
 * Produces a body fragment plus a single stylesheet (see ./css.ts). Security:
 * all text goes through `e()`, every URL sink through `safeUrl()` (iframes are
 * https-only), and no inline `style`/`on*` attributes are ever emitted — so the
 * output is compatible with the Site's strict, hashed CSP.
 *
 * In `editor` mode each element carries `data-nid` (so the studio canvas can map
 * clicks/drops to nodes) and empty containers/images get a visible placeholder.
 * Editor mode is never used by the public Site.
 */
import {safeUrl} from "../url.js";
import {compileTreeCss, nodeClass, typeClass} from "./css.js";
import {renderIcon} from "./icons.js";
import {assertTreeWithinLimits} from "./limits.js";
import type {CollectionItem, CollectionQuery, PrimitiveNode, PrimitiveRenderContext, RenderResult,} from "./types.js";

export interface RenderOptions {
  editor?: boolean;
}

interface RenderEnv {
  ctx: PrimitiveRenderContext;
  editor: boolean;
}

/** HTML-escape a value for text or attribute contexts. */
function e(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

/** Escape and turn newlines into <br> for multi-line text content. */
function textToHtml(value: string): string {
  return e(value).replace(/\r?\n/g, "<br>");
}

function clampLevel(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(6, Math.max(1, Math.floor(n))) : 2;
}

const INPUT_TYPES = new Set(["text", "email", "tel", "number", "password", "url", "date", "search"]);
function inputType(value: unknown): string {
  const t = str(value);
  return INPUT_TYPES.has(t) ? t : "text";
}

/**
 * True when a container holds only columns (2+), so it should lay them out
 * side-by-side. Mixed children (e.g. a heading + a grid) keep the default
 * vertical stack, so presets are unaffected.
 */
function isColumnFlow(node: PrimitiveNode): boolean {
  const kids = node.children;
  if (!kids || kids.length < 2) return false;
  let cols = 0;
  for (const c of kids) if (c.type === "column") cols++;
  return cols >= 2 && cols === kids.length;
}

const FLOW_PARENTS = new Set<string>(["section", "container", "column"]);

function classAttr(node: PrimitiveNode, env: RenderEnv): string {
  const classes = [typeClass(node.type)];
  const nc = nodeClass(node.id);
  if (nc) classes.push(nc);
  if (FLOW_PARENTS.has(node.type) && isColumnFlow(node)) classes.push("ps-flow-row");
  const nid = env.editor ? ` data-nid="${e(node.id)}" draggable="true"` : "";
  return `class="${classes.join(" ")}"${nid}`;
}

/** Binding-aware raw value: an item field inside a collection scope, else props. */
function resolveValue(node: PrimitiveNode, key: string, scope: CollectionItem | null): string {
  const binding = node.bindings?.[key];
  if (binding && scope) return str(scope[binding.field]);
  return str(node.props?.[key]);
}

function httpsUrl(value: string): string {
  const url = safeUrl(value);
  return /^https:\/\//i.test(url) ? url : "";
}

/** Visible affordance for an empty container/leaf while editing. */
function emptyPlaceholder(label: string): string {
  return `<div class="ps-editor-empty" aria-hidden="true">${e(label)}</div>`;
}

const NO_CTX: PrimitiveRenderContext = { listPublished: async () => [] };

/**
 * Static fallback markup for a commerce widget. The storefront client (served
 * from the site origin, CSP-safe) progressively enhances the `data-ps-commerce`
 * element; with no JS the visitor still sees a sensible empty state.
 */
function commerceInner(view: string, node: PrimitiveNode): string {
    if (view === "cartButton") {
        const label = str(node.props?.["label"]) || "Cart";
        return `<span data-ps-cart-label>${e(label)}</span> <span data-ps-cart-count>0</span>`;
    }
    if (view === "checkout") {
        return `<div data-ps-checkout><p class="ps-empty">Your cart is empty.</p></div>`;
    }
    return `<div data-ps-cart><p class="ps-empty">Your cart is empty.</p></div>`;
}

async function renderChildren(
  node: PrimitiveNode,
  env: RenderEnv,
  scope: CollectionItem | null,
): Promise<string> {
  if (!node.children?.length) return "";
  const parts: string[] = [];
  for (const child of node.children) parts.push(await renderNode(child, env, scope));
  return parts.join("");
}

/** Children, or an editor placeholder when a container is empty. */
async function containerInner(
  node: PrimitiveNode,
  env: RenderEnv,
  scope: CollectionItem | null,
  label: string,
): Promise<string> {
  const inner = await renderChildren(node, env, scope);
  if (inner.trim()) return inner;
  return env.editor ? emptyPlaceholder(label) : inner;
}

async function renderCollection(node: PrimitiveNode, env: RenderEnv): Promise<string> {
  const cls = classAttr(node, env);
  const props = node.props ?? {};

  const limitRaw = Number(props["limit"] ?? 6);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 50) : 6;
  const query: CollectionQuery = { limit };
  if (typeof props["typeSlug"] === "string" && props["typeSlug"]) query.typeSlug = props["typeSlug"];
    if (typeof props["source"] === "string" && props["source"]) query.source = props["source"];
  if (typeof props["sortBy"] === "string" && props["sortBy"]) query.sortBy = props["sortBy"];
  if (props["order"] === "asc" || props["order"] === "desc") query.order = props["order"];

  let items: CollectionItem[] = [];
  try {
    items = await env.ctx.listPublished(query);
  } catch {
    items = [];
  }

  const template = node.children ?? [];

  // In the editor, always render the template once (with no item data) so the
  // author can select/style it even before any content exists.
  if (env.editor) {
    let inner = "";
    for (const child of template) inner += await renderNode(child, env, null);
    if (!inner.trim()) inner = emptyPlaceholder("Empty collection template");
    return `<div ${cls}>${inner}</div>`;
  }

  if (!items.length) {
    const empty = e(str(props["emptyText"]) || "Nothing here yet.");
    return `<div ${cls}><p class="ps-empty">${empty}</p></div>`;
  }

  const rows: string[] = [];
  for (const item of items) {
    let inner = "";
    for (const child of template) inner += await renderNode(child, env, item);
    rows.push(inner);
  }
  return `<div ${cls}>${rows.join("")}</div>`;
}

async function renderNode(
  node: PrimitiveNode,
  env: RenderEnv,
  scope: CollectionItem | null,
): Promise<string> {
  const cls = classAttr(node, env);

  switch (node.type) {
    case "section":
      return `<section ${cls}>${await containerInner(node, env, scope, "Empty section")}</section>`;
    case "container":
      return `<div ${cls}>${await containerInner(node, env, scope, "Empty container")}</div>`;
    case "row":
      return `<div ${cls}>${await containerInner(node, env, scope, "Empty row")}</div>`;
    case "column":
      return `<div ${cls}>${await containerInner(node, env, scope, "Empty column")}</div>`;
    case "grid":
      return `<div ${cls}>${await containerInner(node, env, scope, "Empty grid")}</div>`;
    case "spacer":
      return `<div ${cls} aria-hidden="true"></div>`;
    case "divider":
      return `<hr ${cls}>`;

    case "heading": {
      const level = clampLevel(node.props?.["level"]);
      const text = resolveValue(node, "text", scope);
      return `<h${level} ${cls}>${textToHtml(text)}</h${level}>`;
    }
    case "text":
      return `<p ${cls}>${textToHtml(resolveValue(node, "text", scope))}</p>`;
    case "button": {
      const href = safeUrl(resolveValue(node, "href", scope));
      const label = resolveValue(node, "label", scope);
      return `<a ${cls} href="${e(href)}">${e(label)}</a>`;
    }
    case "image": {
      const src = safeUrl(resolveValue(node, "src", scope));
      if (!src) return env.editor ? `<div ${cls}>${emptyPlaceholder("Set image source")}</div>` : "";
      const alt = resolveValue(node, "alt", scope);
      return `<img ${cls} src="${e(src)}" alt="${e(alt)}" loading="lazy">`;
    }
    case "icon": {
      const svg = renderIcon(str(node.props?.["name"]));
      if (svg) return `<span ${cls}>${svg}</span>`;
      return env.editor ? `<span ${cls}>${emptyPlaceholder("icon")}</span>` : "";
    }
    case "video": {
      const url = httpsUrl(resolveValue(node, "url", scope));
      if (!url) return env.editor ? `<div ${cls}>${emptyPlaceholder("Set video URL")}</div>` : "";
      const title = e(resolveValue(node, "title", scope) || "Embedded video");
      return `<div ${cls}><iframe src="${e(url)}" title="${title}" loading="lazy" referrerpolicy="no-referrer" allowfullscreen></iframe></div>`;
    }
    case "list": {
      const tag = node.props?.["ordered"] ? "ol" : "ul";
      return `<${tag} ${cls}>${await containerInner(node, env, scope, "Empty list")}</${tag}>`;
    }
    case "listItem": {
      const inner = node.children?.length
        ? await renderChildren(node, env, scope)
        : textToHtml(resolveValue(node, "text", scope));
      return `<li ${cls}>${inner}</li>`;
    }

    case "collectionList":
      return renderCollection(node, env);

      case "addToCart": {
          const productId = resolveValue(node, "productId", scope);
          const variantId = resolveValue(node, "variantId", scope);
          const label = resolveValue(node, "label", scope) || "Add to cart";
          const qtyRaw = Number(node.props?.["qty"] ?? 1);
          const qty = Number.isFinite(qtyRaw) ? Math.min(Math.max(1, Math.floor(qtyRaw)), 99) : 1;
          return `<button ${cls} type="button" data-ps-add="${e(productId)}" data-ps-variant="${e(variantId)}" data-ps-qty="${qty}">${e(label)}</button>`;
      }
      case "commerce": {
          const raw = str(node.props?.["view"]);
          const view = raw === "cartButton" || raw === "checkout" ? raw : "cart";
          return `<div ${cls} data-ps-commerce="${view}">${commerceInner(view, node)}</div>`;
      }

    case "form": {
      const action = safeUrl(resolveValue(node, "action", scope)) || "#";
      const fields = await containerInner(node, env, scope, "Empty form");
      return `<form ${cls} method="post" action="${e(action)}">${fields}</form>`;
    }
    case "input": {
      const name = e(str(node.props?.["name"]));
      const label = resolveValue(node, "label", scope);
      const type = inputType(node.props?.["inputType"]);
      const ph = e(str(node.props?.["placeholder"]));
      const required = node.props?.["required"] ? " required" : "";
      const labelEl = label ? `<span>${e(label)}</span>` : "";
      return `<label ${cls}>${labelEl}<input type="${type}" name="${name}" placeholder="${ph}"${required}></label>`;
    }
    case "textarea": {
      const name = e(str(node.props?.["name"]));
      const label = resolveValue(node, "label", scope);
      const ph = e(str(node.props?.["placeholder"]));
      const required = node.props?.["required"] ? " required" : "";
      const rowsRaw = Number(node.props?.["rows"] ?? 4);
      const rows = Number.isFinite(rowsRaw) ? Math.min(Math.max(2, Math.floor(rowsRaw)), 20) : 4;
      const labelEl = label ? `<span>${e(label)}</span>` : "";
      return `<label ${cls}>${labelEl}<textarea name="${name}" rows="${rows}" placeholder="${ph}"${required}></textarea></label>`;
    }
    case "submit": {
      const label = resolveValue(node, "label", scope) || "Submit";
      return `<button ${cls} type="submit">${e(label)}</button>`;
    }

    default:
      return `<!-- unknown primitive -->`;
  }
}

/**
 * Renders a primitive tree to an HTML body fragment and one stylesheet. Data
 * primitives use `ctx`; when omitted they render their empty state. Pass
 * `{ editor: true }` to emit `data-nid` and empty-container placeholders.
 */
export async function renderTree(
  nodes: PrimitiveNode[],
  ctx: PrimitiveRenderContext = NO_CTX,
  opts: RenderOptions = {},
): Promise<RenderResult> {
    // Bound the work BEFORE the recursive render/CSS passes: the tree is
    // attacker-influenced (a stored designer layout, or the studio preview body),
    // so an unbounded one would be a CPU/stack DoS. Throws `validation` (400).
    assertTreeWithinLimits(nodes);
  const env: RenderEnv = { ctx, editor: opts.editor === true };
  const parts: string[] = [];
  for (const node of nodes) parts.push(await renderNode(node, env, null));
  return { html: parts.join("\n"), css: compileTreeCss(nodes) };
}
