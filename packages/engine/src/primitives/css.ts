/**
 * Constrained style → CSS compiler.
 *
 * Security model: there is no raw-CSS surface. Every style value is validated
 * against a strict per-property pattern (mirroring the theme-token validation in
 * ../theming.ts) before it becomes a declaration, and a final defense-in-depth
 * net rejects any value still carrying CSS control characters. The output is one
 * deterministic stylesheet so the Site's hashed `style-src` CSP stays valid
 * across cache hits (no inline `style=""` attributes are ever emitted).
 */
import { safeUrl } from "../url.js";
import type {
  Breakpoint,
  PrimitiveNode,
  PrimitiveType,
  ResponsiveStyles,
  StyleProps,
  StyleState,
} from "./types.js";

export const TYPE_CLASS_PREFIX = "pst-";
export const NODE_CLASS_PREFIX = "psn-";

/** Sanitises a node id into a CSS-class-safe token. */
export function cssId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "");
}

export function nodeClass(id: string): string {
  const safe = cssId(id);
  return safe ? NODE_CLASS_PREFIX + safe : "";
}

export function typeClass(type: PrimitiveType): string {
  return TYPE_CLASS_PREFIX + type;
}

// ── value validators ────────────────────────────────────────────────────────
const SIZE_RE = /^-?\d+(\.\d+)?(px|rem|em|%|vw|vh|fr|ch)$/;
const POS_NUM_RE = /^\d+(\.\d+)?$/;
const INT_RE = /^-?\d+$/;
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;
const HSL_RE = /^hsla?\(\s*\d{1,3}(\.\d+)?\s*,\s*\d{1,3}(\.\d+)?%\s*,\s*\d{1,3}(\.\d+)?%\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;
const TOKEN_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
const FONT_RE = /^[a-zA-Z0-9 ,'"-]+$/;
const SHADOW_RE =
  /^(inset\s+)?((0|-?\d+(\.\d+)?(px|rem|em))\s+){2,4}(#[0-9a-fA-F]{3,8}|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\))?$/;
const GRID_TOKEN_RE =
  /^(repeat\(\d{1,3},(1fr|auto|\d+(\.\d+)?(px|rem|fr|%)|minmax\(0,1fr\))\)|1fr|auto|minmax\(0,1fr\)|\d+(\.\d+)?(px|rem|fr|%))$/;

type Validator = (raw: string) => string | null;

function tokenOr(re: RegExp): Validator {
  return (raw) => {
    if (raw.startsWith("token:")) {
      const key = raw.slice(6);
      return TOKEN_KEY_RE.test(key) ? `var(--${key})` : null;
    }
    return re.test(raw) ? raw : null;
  };
}

const vColor: Validator = (raw) => {
  if (raw.startsWith("token:")) {
    const key = raw.slice(6);
    return TOKEN_KEY_RE.test(key) ? `var(--${key})` : null;
  }
  if (raw === "transparent" || raw === "currentColor" || raw === "inherit") return raw;
  return HEX_RE.test(raw) || RGB_RE.test(raw) || HSL_RE.test(raw) ? raw : null;
};

const vSize: Validator = (raw) => {
  if (raw === "0" || raw === "auto" || raw === "none") return raw;
  return tokenOr(SIZE_RE)(raw);
};

const vSizeNoToken: Validator = (raw) =>
  raw === "0" || raw === "auto" || raw === "none" ? raw : SIZE_RE.test(raw) ? raw : null;

// Strict fluid-type form: `clamp(<size>, calc(<n>vw +/- <size>), <size>)`. Only
// the auto-responsive synthesizer below emits this; it stays inside the
// type-validated CSS surface (no raw clamp from arbitrary input).
const FLUID_FONT_RE =
  /^clamp\(\s*-?\d+(\.\d+)?(px|rem|em),\s*calc\(\s*-?\d+(\.\d+)?vw\s*[+-]\s*\d+(\.\d+)?(px|rem|em)\s*\),\s*-?\d+(\.\d+)?(px|rem|em)\s*\)$/;
const vFontSize: Validator = (raw) => (FLUID_FONT_RE.test(raw) ? raw : vSize(raw));

const vInt: Validator = (raw) => (INT_RE.test(raw) ? raw : null);

const vOpacity: Validator = (raw) => {
  if (!POS_NUM_RE.test(raw)) return null;
  const n = Number(raw);
  return n >= 0 && n <= 1 ? raw : null;
};

const vLineHeight: Validator = (raw) =>
  POS_NUM_RE.test(raw) || SIZE_RE.test(raw) || raw === "normal" ? raw : null;

const vFontWeight: Validator = (raw) =>
  raw === "normal" || raw === "bold" || raw === "lighter" || raw === "bolder"
    ? raw
    : /^[1-9]00$/.test(raw)
      ? raw
      : null;

const vFont: Validator = (raw) => {
  if (raw.startsWith("token:")) {
    const key = raw.slice(6);
    return TOKEN_KEY_RE.test(key) ? `var(--${key})` : null;
  }
  return FONT_RE.test(raw) ? raw : null;
};

function vEnum(...allowed: string[]): Validator {
  const set = new Set(allowed);
  return (raw) => (set.has(raw) ? raw : null);
}

const vShadow: Validator = (raw) => (raw === "none" ? "none" : SHADOW_RE.test(raw) ? raw : null);

const vGrid: Validator = (raw) => {
  const tokens = raw.trim().split(/\s+/);
  if (!tokens.length || tokens.length > 12) return null;
  return tokens.every((t) => GRID_TOKEN_RE.test(t)) ? tokens.join(" ") : null;
};

const vBgImage: Validator = (raw) => {
  const url = safeUrl(raw);
  if (!url) return null;
  if (/["'()\s\\<>]/.test(url)) return null;
  return `url("${url}")`;
};

const vBgPosition: Validator = (raw) =>
  /^(center|top|bottom|left|right)( (center|top|bottom|left|right))?$/.test(raw) ? raw : null;

// ── property spec ─────────────────────────────────────────────────────────────
interface Spec {
  css: string;
  validate: Validator;
}

const STYLE_SPEC: Record<keyof StyleProps, Spec> = {
  display: { css: "display", validate: vEnum("block", "inline-block", "inline", "flex", "inline-flex", "grid", "none") },
  flexDirection: { css: "flex-direction", validate: vEnum("row", "row-reverse", "column", "column-reverse") },
  justifyContent: {
    css: "justify-content",
    validate: vEnum("flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly", "start", "end"),
  },
  alignItems: { css: "align-items", validate: vEnum("stretch", "flex-start", "flex-end", "center", "baseline", "start", "end") },
  gap: { css: "gap", validate: vSize },
  flexWrap: { css: "flex-wrap", validate: vEnum("nowrap", "wrap", "wrap-reverse") },
  gridTemplateColumns: { css: "grid-template-columns", validate: vGrid },

  paddingTop: { css: "padding-top", validate: vSize },
  paddingRight: { css: "padding-right", validate: vSize },
  paddingBottom: { css: "padding-bottom", validate: vSize },
  paddingLeft: { css: "padding-left", validate: vSize },
  marginTop: { css: "margin-top", validate: vSize },
  marginRight: { css: "margin-right", validate: vSize },
  marginBottom: { css: "margin-bottom", validate: vSize },
  marginLeft: { css: "margin-left", validate: vSize },

  width: { css: "width", validate: vSize },
  maxWidth: { css: "max-width", validate: vSize },
  height: { css: "height", validate: vSize },
  minHeight: { css: "min-height", validate: vSize },
  maxHeight: { css: "max-height", validate: vSize },

  fontSize: { css: "font-size", validate: vFontSize },
  fontWeight: { css: "font-weight", validate: vFontWeight },
  lineHeight: { css: "line-height", validate: vLineHeight },
  letterSpacing: { css: "letter-spacing", validate: vSizeNoToken },
  textAlign: { css: "text-align", validate: vEnum("left", "center", "right", "justify") },
  color: { css: "color", validate: vColor },
  fontFamily: { css: "font-family", validate: vFont },

  background: { css: "background", validate: vColor },
  backgroundImage: { css: "background-image", validate: vBgImage },
  backgroundSize: { css: "background-size", validate: vEnum("cover", "contain", "auto") },
  backgroundPosition: { css: "background-position", validate: vBgPosition },

  borderWidth: { css: "border-width", validate: vSizeNoToken },
  borderStyle: { css: "border-style", validate: vEnum("none", "solid", "dashed", "dotted", "double") },
  borderColor: { css: "border-color", validate: vColor },
  borderRadius: { css: "border-radius", validate: vSize },

  boxShadow: { css: "box-shadow", validate: vShadow },
  opacity: { css: "opacity", validate: vOpacity },

  position: { css: "position", validate: vEnum("static", "relative", "absolute", "sticky", "fixed") },
  top: { css: "top", validate: vSize },
  right: { css: "right", validate: vSize },
  bottom: { css: "bottom", validate: vSize },
  left: { css: "left", validate: vSize },
  zIndex: { css: "z-index", validate: vInt },
};

/** Rejects any validated value that still carries CSS-structural characters. */
function isSafeDeclValue(value: string): boolean {
  if (/[;{}<>]/.test(value)) return false;
  if (value.includes("/*") || value.includes("*/")) return false;
  if (value.includes("\\")) return false;
  if (/expression\s*\(/i.test(value)) return false;
  return true;
}

/** Compiles one StyleProps block into a `prop:value;…` declaration string. */
export function compileDeclarations(sp: StyleProps): string {
  const decls: string[] = [];
  for (const key of Object.keys(sp) as (keyof StyleProps)[]) {
    const raw = sp[key];
    if (raw == null || raw === "") continue;
    const spec = STYLE_SPEC[key];
    if (!spec) continue;
    const value = spec.validate(String(raw).trim());
    if (value == null || !isSafeDeclValue(value)) continue;
    decls.push(`${spec.css}:${value}`);
  }
  return decls.join(";");
}

const BREAKPOINT_ORDER: Breakpoint[] = ["base", "tablet", "mobile"];
const STATE_ORDER: StyleState[] = ["default", "hover"];
const BREAKPOINT_MEDIA: Record<Breakpoint, string | null> = {
  base: null,
  tablet: "(max-width:768px)",
  mobile: "(max-width:480px)",
};

// ── auto-responsive synthesis ────────────────────────────────────────────────
// Make any layout adapt across desktop/tablet/mobile with zero manual work, while
// a designer's explicit per-breakpoint value always wins (synthesis only fills
// gaps; it never overrides a value the designer set for that property+breakpoint).

/** The grid base default; equal-fraction grids collapse from this. */
const DEFAULT_GRID_COLS = "repeat(3,1fr)";
/** Below this size, type is left fixed — only larger headings scale fluidly. */
const FLUID_MIN_PX = 24;

/** Collapsed tablet/mobile column tracks for an equal-fraction grid. */
function collapseGridCols(baseCols: string): { tablet?: string; mobile?: string } {
  const s = baseCols.trim();
  const m = /^repeat\((\d{1,3}),1fr\)$/.exec(s);
  let equalCount = 0;
  if (m) equalCount = Number(m[1]);
  else {
    const toks = s.split(/\s+/);
    if (toks.length > 1 && toks.every((t) => t === "1fr")) equalCount = toks.length;
    else if (toks.length > 1) return { mobile: "1fr" }; // arbitrary track list → stack on mobile
    else return {};
  }
  if (equalCount <= 1) return {};
  if (equalCount === 2) return { mobile: "1fr" };
  return { tablet: "repeat(2,1fr)", mobile: "1fr" };
}

function parseToPx(raw: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)(px|rem|em)$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "px" ? n : n * 16;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Fluid font-size as a `clamp()` that equals the set value on wide viewports and
 * shrinks to a floor on narrow ones — so large headings never overflow on mobile.
 * Returns null for small/unparseable sizes (left fixed).
 */
function fluidFontSize(raw: string): string | null {
  const maxPx = parseToPx(raw);
  if (maxPx == null || maxPx < FLUID_MIN_PX) return null;
  const minPx = Math.max(18, Math.round(maxPx * 0.62));
  if (minPx >= maxPx) return null;
  const minVw = 320;
  const maxVw = 1200;
  const slope = (maxPx - minPx) / (maxVw - minVw);
  const a = round3(slope * 100);
  const bRem = round3((minPx - slope * minVw) / 16);
  const minRem = round3(minPx / 16);
  const maxRem = round3(maxPx / 16);
  const mid = bRem < 0 ? `calc(${a}vw - ${Math.abs(bRem)}rem)` : `calc(${a}vw + ${bRem}rem)`;
  return `clamp(${minRem}rem, ${mid}, ${maxRem}rem)`;
}

/**
 * Returns the node's styles augmented with synthesized responsive defaults.
 * Designer-set values are preserved verbatim; synthesis only adds what's missing.
 */
function synthesizeResponsive(node: PrimitiveNode): ResponsiveStyles | undefined {
  const src = node.styles;
  const isGrid = node.type === "grid" || node.type === "collectionList";
  const gridAdds = isGrid
    ? collapseGridCols(src?.base?.default?.gridTemplateColumns ?? DEFAULT_GRID_COLS)
    : {};
  const baseFont = src?.base?.default?.fontSize;
  const designerScalesFont =
    src?.tablet?.default?.fontSize != null || src?.mobile?.default?.fontSize != null;
  const fluid = baseFont && !designerScalesFont ? fluidFontSize(baseFont) : null;

  if (!src && !gridAdds.tablet && !gridAdds.mobile && !fluid) return undefined;

  const out: ResponsiveStyles = {};
  for (const bp of BREAKPOINT_ORDER) {
    const st = src?.[bp];
    if (!st) continue;
    out[bp] = {};
    if (st.default) out[bp]!.default = { ...st.default };
    if (st.hover) out[bp]!.hover = { ...st.hover };
  }
  const ensureDefault = (bp: Breakpoint): StyleProps => {
    const block = (out[bp] ??= {});
    return (block.default ??= {});
  };
  if (gridAdds.tablet && src?.tablet?.default?.gridTemplateColumns == null)
    ensureDefault("tablet").gridTemplateColumns = gridAdds.tablet;
  if (gridAdds.mobile && src?.mobile?.default?.gridTemplateColumns == null)
    ensureDefault("mobile").gridTemplateColumns = gridAdds.mobile;
  if (fluid) ensureDefault("base").fontSize = fluid;
  return out;
}

// ── height-fill: children of a fixed-height container stretch to fill it ──────
/** Containers whose layout children stretch to fill an explicit parent height. */
const HEIGHT_FILL_PARENTS = new Set<PrimitiveType>(["section", "container", "column"]);
/** Only layout children grow (zero-specificity list); text/media keep natural height. */
const HEIGHT_FILL_CHILDREN = ".pst-section,.pst-container,.pst-row,.pst-column,.pst-grid";

/** Mirrors render.ts isColumnFlow: a 2+ all-column group is laid out as a row. */
function childrenAreColumnFlow(children: PrimitiveNode[] | undefined): boolean {
  if (!children || children.length < 2) return false;
  return children.every((c) => c.type === "column");
}

/**
 * When a container has an explicit height/min-height, its layout children should
 * fill that height (a designer's mental model: the child "inherits" the parent
 * height). Columns in a row already stretch via `align-items:stretch`; this
 * covers the block-stacked case by flexing the parent's column axis and letting
 * structural children grow. Skipped when the children are a column-flow row, or
 * when the designer set their own display/direction.
 */
function heightFillCss(node: PrimitiveNode, cls: string): string[] {
  const baseDef = node.styles?.base?.default;
  if (
    !HEIGHT_FILL_PARENTS.has(node.type) ||
    !baseDef ||
    !(baseDef.height || baseDef.minHeight) ||
    !node.children?.length ||
    childrenAreColumnFlow(node.children) ||
    baseDef.display ||
    baseDef.flexDirection
  ) {
    return [];
  }
  const rules: string[] = [];
  // Doubled class (0,2,0) so this beats the type default (e.g. section's
  // `display:block`). Columns are already flex-column; sections/containers
  // default to block.
  if (node.type !== "column") rules.push(`.${cls}.${cls}{display:flex;flex-direction:column}`);
  rules.push(`.${cls}.${cls}>:where(${HEIGHT_FILL_CHILDREN}){flex:1 1 auto;min-height:0}`);
  return rules;
}

/** Per-node CSS across all breakpoints and states, keyed by the node's class. */
export function compileNodeCss(node: PrimitiveNode): string {
  const cls = nodeClass(node.id);
  const styles = synthesizeResponsive(node);
  if (!cls || !styles) return "";
  const out: string[] = [];
  for (const bp of BREAKPOINT_ORDER) {
    const states = styles[bp];
    if (!states) continue;
    for (const state of STATE_ORDER) {
      const sp = states[state];
      if (!sp) continue;
      let decl = compileDeclarations(sp);
      if (!decl) continue;
      // Every per-node rule doubles its class (`.psn-id.psn-id`, specificity
      // 0,2,0) so a designer's explicit style always beats the structural type
      // default `.pst-type` (0,1,0) — even across separate stylesheets, e.g. a
      // header fragment plus the page, where source order alone is unreliable.
      // Type defaults stay single-class (0,1,0) so they still beat the theme's
      // bare element selectors (`h2`, `p`, `img` … 0,0,1) and reset their leak.
      // A column inside a row is force-flexed by COLUMN_FLEX_CSS (now zero-spec
      // `:where(...)`), whose `flex:1 1 <basis>` sets flex-basis: when a designer
      // sets an explicit width, reset flex (→ flex-basis:auto) so the width — not
      // the basis — drives the column's size.
      const base = `.${cls}.${cls}`;
      if (node.type === "column" && /(?:^|;)width:/.test(decl)) {
        decl += ";flex:0 0 auto";
      }
      const selector = state === "hover" ? `${base}:hover` : base;
      const rule = `${selector}{${decl}}`;
      const media = BREAKPOINT_MEDIA[bp];
      out.push(media ? `@media${media}{${rule}}` : rule);
    }
  }
  out.push(...heightFillCss(node, cls));
  return out.join("");
}

/**
 * Structural defaults emitted once per primitive type present in the tree
 * (deduped), keyed by the `pst-<type>` class. Per-node styles layer on top.
 */
const BASE_CSS: Partial<Record<PrimitiveType, string>> = {
  section: "display:block;width:100%",
  container: "width:100%;max-width:1100px;margin-left:auto;margin-right:auto",
  row: "display:flex;flex-direction:row;flex-wrap:wrap",
  column: "display:flex;flex-direction:column;min-width:0",
  grid: "display:grid;grid-template-columns:repeat(3,1fr)",
  spacer: "display:block;height:2rem",
  divider: "border:0;border-top:1px solid currentColor;opacity:.15;margin:0",
  heading: "margin:0;line-height:1.2",
  text: "margin:0;line-height:1.65",
  button: "display:inline-flex;align-items:center;justify-content:center;gap:.4rem;text-decoration:none;padding:.7rem 1.4rem;border-radius:8px;font-weight:600;cursor:pointer",
  image: "display:block;max-width:100%;height:auto;margin:0",
  icon: "display:inline-flex;align-items:center;justify-content:center;width:1.5em;height:1.5em",
  video: "position:relative;width:100%;aspect-ratio:16/9",
  list: "margin:0;padding-left:1.25rem;line-height:1.7",
  listItem: "margin:0",
  collectionList: "display:grid;gap:1.25rem;grid-template-columns:repeat(3,1fr)",
  form: "display:flex;flex-direction:column;gap:1rem",
  input: "display:flex;flex-direction:column;gap:.35rem",
  textarea: "display:flex;flex-direction:column;gap:.35rem",
  submit: "display:inline-flex;align-items:center;justify-content:center;padding:.7rem 1.4rem;border:0;border-radius:8px;font-weight:600;cursor:pointer",
};

const VIDEO_FRAME_CSS = `.${TYPE_CLASS_PREFIX}video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}`;
const FIELD_INPUT_CSS = `.${TYPE_CLASS_PREFIX}input input,.${TYPE_CLASS_PREFIX}textarea textarea{font:inherit;padding:.6rem .75rem;border:1px solid #d8dee9;border-radius:8px;width:100%}`;
// A container holding only columns lays them side-by-side (set via the renderer
// adding `ps-flow-row`); columns directly inside a row/flow-row share width.
// A non-zero flex-basis lets columns wrap intrinsically once the row gets too
// narrow to fit them at a readable width — responsive with no breakpoint needed.
const COL_FLEX_BASIS = "220px";
const FLOW_ROW_CSS = `.ps-flow-row{display:flex;flex-direction:row;flex-wrap:wrap;align-items:stretch}`;
// `:where()` (zero specificity) so an explicit per-node column style — width,
// flex, etc. (doubled class, 0,2,0) — always wins, even when the page's own
// stylesheet re-emits this same descendant rule (also a class-tuple) later in
// the document than a header/footer fragment's per-node override.
const COLUMN_FLEX_CSS = `:where(.${TYPE_CLASS_PREFIX}row>.${TYPE_CLASS_PREFIX}column,.ps-flow-row>.${TYPE_CLASS_PREFIX}column){flex:1 1 ${COL_FLEX_BASIS}}`;

/**
 * Shared auto-responsive rules emitted once for the whole tree. They sit in the
 * base block (before per-node rules); a designer's per-breakpoint override is a
 * doubled-class per-node rule (0,2,0) and so always wins over these type-level
 * defaults (0,1,0) regardless of source order.
 */
function responsiveBaseCss(types: Set<PrimitiveType>): string {
  const C = TYPE_CLASS_PREFIX;
  const mobile: string[] = [];
  if (types.has("row")) mobile.push(`.${C}row{flex-direction:column}`);
  if (types.has("column")) {
    mobile.push(`.ps-flow-row{flex-direction:column}`);
    // Stacked columns size to content instead of sharing space / forcing a min
    // height. `:where()` for the same reason as COLUMN_FLEX_CSS — an explicit
    // per-node column override must out-rank this default across stylesheets.
    mobile.push(`:where(.ps-flow-row>.${C}column,.${C}row>.${C}column){flex-basis:auto}`);
  }
  return mobile.length ? `@media(max-width:480px){${mobile.join("")}}` : "";
}

/** Collects every primitive type that appears in the tree, in stable order. */
function collectTypes(nodes: PrimitiveNode[], seen: Set<PrimitiveType>): void {
  for (const n of nodes) {
    seen.add(n.type);
    if (n.children?.length) collectTypes(n.children, seen);
  }
}

function collectNodeCss(nodes: PrimitiveNode[], out: string[]): void {
  for (const n of nodes) {
    const css = compileNodeCss(n);
    if (css) out.push(css);
    if (n.children?.length) collectNodeCss(n.children, out);
  }
}

const TYPE_ORDER = Object.keys(BASE_CSS) as PrimitiveType[];

/**
 * Compiles the whole tree to one deterministic stylesheet: base type rules
 * (deduped, in fixed order) followed by per-node rules in tree order.
 *
 * Specificity is layered in three tiers so the cascade is order-independent
 * across separately-emitted stylesheets (e.g. a header/footer fragment plus the
 * page): the theme's bare element selectors (`h2`, `p`, `img` … 0,0,1) are the
 * floor; `.pst-type` defaults (0,1,0) sit above them and reset that leak; and
 * doubled-class `.psn-id.psn-id` per-node rules (0,2,0) win over both.
 */
export function compileTreeCss(nodes: PrimitiveNode[]): string {
  const types = new Set<PrimitiveType>();
  collectTypes(nodes, types);

  const base: string[] = [];
  for (const type of TYPE_ORDER) {
    if (!types.has(type)) continue;
    const css = BASE_CSS[type];
    if (css) base.push(`.${typeClass(type)}{${css}}`);
    if (type === "video") base.push(VIDEO_FRAME_CSS);
  }
  if (types.has("input") || types.has("textarea")) base.push(FIELD_INPUT_CSS);
  if (types.has("column")) {
    base.push(FLOW_ROW_CSS);
    base.push(COLUMN_FLEX_CSS);
  }
  const responsive = responsiveBaseCss(types);
  if (responsive) base.push(responsive);

  const perNode: string[] = [];
  collectNodeCss(nodes, perNode);

  return [...base, ...perNode].join("\n");
}
