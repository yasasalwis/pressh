/**
 * Palette metadata for every primitive type. The studio left panel renders these
 * as draggable items; the canvas seeds a freshly-inserted node with `defaultProps`
 * and `defaultStyles`. `isContainer` marks primitives that accept dropped children.
 */
import type { PrimitiveType, ResponsiveStyles, StyleProps } from "./types.js";

export type PrimitiveCategory = "layout" | "content" | "data" | "form";

export interface PrimitiveDef {
  type: PrimitiveType;
  name: string;
  icon: string;
  category: PrimitiveCategory;
  description: string;
  isContainer: boolean;
  defaultProps?: Record<string, unknown>;
  defaultStyles?: ResponsiveStyles;
}

function base(styles: StyleProps): ResponsiveStyles {
  return { base: { default: styles } };
}

export const PRIMITIVE_DEFS: PrimitiveDef[] = [
  // ── layout ──
  {
    type: "section",
    name: "Section",
    icon: "▭",
    category: "layout",
    description: "Full-width band that wraps a row of content",
    isContainer: true,
    defaultStyles: base({ paddingTop: "4rem", paddingBottom: "4rem" }),
  },
  {
    type: "container",
    name: "Container",
    icon: "▢",
    category: "layout",
    description: "Centered, max-width content well",
    isContainer: true,
  },
  {
    type: "row",
    name: "Row",
    icon: "▥",
    category: "layout",
    description: "Horizontal flex group",
    isContainer: true,
    defaultStyles: base({ alignItems: "center" }),
  },
  {
    type: "column",
    name: "Column",
    icon: "▤",
    category: "layout",
    description: "Vertical flex group",
    isContainer: true,
  },
  {
    type: "grid",
    name: "Grid",
    icon: "▦",
    category: "layout",
    description: "Responsive grid of equal cells",
    isContainer: true,
    defaultStyles: base({ gridTemplateColumns: "repeat(3,1fr)" }),
  },
  {
    type: "spacer",
    name: "Spacer",
    icon: "↕",
    category: "layout",
    description: "Adjustable vertical gap",
    isContainer: false,
    defaultStyles: base({ height: "3rem" }),
  },
  {
    type: "divider",
    name: "Divider",
    icon: "—",
    category: "layout",
    description: "Horizontal rule",
    isContainer: false,
  },

  // ── content ──
  {
    type: "heading",
    name: "Heading",
    icon: "H",
    category: "content",
    description: "Title text (h1–h6)",
    isContainer: false,
    defaultProps: { text: "Heading", level: 2 },
    defaultStyles: base({ fontSize: "1.75rem", fontWeight: "800", color: "token:colorText" }),
  },
  {
    type: "text",
    name: "Text",
    icon: "¶",
    category: "content",
    description: "Paragraph / body copy",
    isContainer: false,
    defaultProps: { text: "Write something descriptive here." },
    defaultStyles: base({ color: "token:colorText", lineHeight: "1.7" }),
  },
  {
    type: "button",
    name: "Button",
    icon: "⬭",
    category: "content",
    description: "Link styled as a button",
    isContainer: false,
    defaultProps: { label: "Get started", href: "#" },
    defaultStyles: base({ background: "token:colorPrimary", color: "#ffffff" }),
  },
  {
    type: "image",
    name: "Image",
    icon: "🖼",
    category: "content",
    description: "Responsive image",
    isContainer: false,
    defaultProps: { src: "", alt: "" },
    defaultStyles: base({ borderRadius: "12px" }),
  },
  {
    type: "icon",
    name: "Icon",
    icon: "★",
    category: "content",
    description: "Inline SVG icon",
    isContainer: false,
    defaultProps: { name: "star" },
    defaultStyles: base({ color: "token:colorPrimary", width: "2rem", height: "2rem" }),
  },
  {
    type: "video",
    name: "Video",
    icon: "▶",
    category: "content",
    description: "Embedded video (https iframe)",
    isContainer: false,
    defaultProps: { url: "", title: "Video" },
  },
  {
    type: "list",
    name: "List",
    icon: "≣",
    category: "content",
    description: "Bulleted or numbered list",
    isContainer: true,
    defaultProps: { ordered: false },
  },
  {
    type: "listItem",
    name: "List item",
    icon: "•",
    category: "content",
    description: "A single list entry",
    isContainer: true,
    defaultProps: { text: "List item" },
  },

  // ── data ──
  {
    type: "collectionList",
    name: "Collection List",
    icon: "🗂",
    category: "data",
    description: "Repeats its template for each published entry",
    isContainer: true,
    defaultProps: { limit: 6, emptyText: "Nothing published yet." },
    defaultStyles: base({ gridTemplateColumns: "repeat(3,1fr)", gap: "1.5rem" }),
  },

  // ── form ──
  {
    type: "form",
    name: "Form",
    icon: "🗎",
    category: "form",
    description: "Submittable form wrapper",
    isContainer: true,
    defaultProps: { action: "#" },
    defaultStyles: base({ gap: "1rem" }),
  },
  {
    type: "input",
    name: "Input",
    icon: "⌶",
    category: "form",
    description: "Labelled text field",
    isContainer: false,
    defaultProps: { name: "field", label: "Label", inputType: "text", placeholder: "" },
  },
  {
    type: "textarea",
    name: "Textarea",
    icon: "❑",
    category: "form",
    description: "Multi-line text field",
    isContainer: false,
    defaultProps: { name: "message", label: "Message", rows: 4, placeholder: "" },
  },
  {
    type: "submit",
    name: "Submit",
    icon: "➤",
    category: "form",
    description: "Form submit button",
    isContainer: false,
    defaultProps: { label: "Submit" },
    defaultStyles: base({ background: "token:colorPrimary", color: "#ffffff" }),
  },
];

const DEF_BY_TYPE = new Map<PrimitiveType, PrimitiveDef>(PRIMITIVE_DEFS.map((d) => [d.type, d]));

export function getPrimitiveDef(type: PrimitiveType): PrimitiveDef | undefined {
  return DEF_BY_TYPE.get(type);
}
