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

  fontSize: { css: "font-size", validate: vSize },
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

/** Per-node CSS across all breakpoints and states, keyed by the node's class. */
export function compileNodeCss(node: PrimitiveNode): string {
  const cls = nodeClass(node.id);
  const styles: ResponsiveStyles | undefined = node.styles;
  if (!cls || !styles) return "";
  const out: string[] = [];
  for (const bp of BREAKPOINT_ORDER) {
    const states = styles[bp];
    if (!states) continue;
    for (const state of STATE_ORDER) {
      const sp = states[state];
      if (!sp) continue;
      const decl = compileDeclarations(sp);
      if (!decl) continue;
      const selector = state === "hover" ? `.${cls}:hover` : `.${cls}`;
      const rule = `${selector}{${decl}}`;
      const media = BREAKPOINT_MEDIA[bp];
      out.push(media ? `@media${media}{${rule}}` : rule);
    }
  }
  return out.join("");
}

/**
 * Structural defaults emitted once per primitive type present in the tree
 * (deduped), keyed by the `pst-<type>` class. Per-node styles layer on top.
 */
const BASE_CSS: Partial<Record<PrimitiveType, string>> = {
  section: "display:block;width:100%",
  container: "width:100%;max-width:1100px;margin-left:auto;margin-right:auto;padding-left:1.5rem;padding-right:1.5rem",
  row: "display:flex;flex-direction:row;gap:1rem",
  column: "display:flex;flex-direction:column;gap:1rem",
  grid: "display:grid;gap:1rem;grid-template-columns:repeat(3,1fr)",
  spacer: "display:block;height:2rem",
  divider: "border:0;border-top:1px solid currentColor;opacity:.15;margin:0",
  heading: "margin:0;line-height:1.2",
  text: "margin:0;line-height:1.65",
  button: "display:inline-flex;align-items:center;justify-content:center;gap:.4rem;text-decoration:none;padding:.7rem 1.4rem;border-radius:8px;font-weight:600;cursor:pointer",
  image: "display:block;max-width:100%;height:auto",
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

  const perNode: string[] = [];
  collectNodeCss(nodes, perNode);

  return [...base, ...perNode].join("\n");
}
