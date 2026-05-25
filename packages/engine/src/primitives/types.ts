/**
 * Primitive page model.
 *
 * A page is a tree of PrimitiveNodes. Composite "components" (Hero, Feature
 * Grid, …) are presets that expand into these primitives at design time, so the
 * stored tree is always primitives only — there is no opaque component node.
 *
 * Styling is a constrained, type-validated style system (see ./css.ts): every
 * value is checked against a per-property pattern so a value can never break out
 * of a CSS declaration. There is deliberately no raw-CSS surface, mirroring the
 * theme-token model in ../theming.ts.
 */

/** Responsive breakpoints. `base` = desktop-first; the others are max-width media. */
export type Breakpoint = "base" | "tablet" | "mobile";

/** Interaction states a style block can target. */
export type StyleState = "default" | "hover";

/**
 * The whitelist of styleable properties. Each maps to one CSS declaration and is
 * validated by ./css.ts. Keep this in sync with STYLE_SPEC there.
 */
export interface StyleProps {
  // layout
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  gap?: string;
  flexWrap?: string;
  gridTemplateColumns?: string;
  // spacing
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  // size
  width?: string;
  maxWidth?: string;
  height?: string;
  minHeight?: string;
  maxHeight?: string;
  // typography
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: string;
  color?: string;
  fontFamily?: string;
  // background
  background?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  // border
  borderWidth?: string;
  borderStyle?: string;
  borderColor?: string;
  borderRadius?: string;
  // effects
  boxShadow?: string;
  opacity?: string;
  // position
  position?: string;
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  zIndex?: string;
}

export type StateStyles = Partial<Record<StyleState, StyleProps>>;
export type ResponsiveStyles = Partial<Record<Breakpoint, StateStyles>>;

/** The set of primitive element types the renderer understands. */
export type PrimitiveType =
  // layout
  | "section"
  | "container"
  | "row"
  | "column"
  | "grid"
  | "spacer"
  | "divider"
  // content
  | "heading"
  | "text"
  | "button"
  | "image"
  | "icon"
  | "video"
  | "list"
  | "listItem"
  // data
  | "collectionList"
    // commerce (contributed via a plugin's designer presets; not in the base palette)
    | "addToCart"
    | "commerce"
  // forms
  | "form"
  | "input"
  | "textarea"
  | "submit";

/**
 * Binds a node's content prop to a field of the current collection item, so a
 * primitive inside a CollectionList template renders per-item data. `as` selects
 * the sink: "text" is HTML-escaped, "url" is run through safeUrl.
 */
export interface Binding {
  field: string;
  as?: "text" | "url";
}

export interface PrimitiveNode {
  id: string;
  type: PrimitiveType;
  props?: Record<string, unknown>;
  bindings?: Record<string, Binding>;
  styles?: ResponsiveStyles;
  children?: PrimitiveNode[];
}

/** A page's stored content is an array of root primitives. */
export type DesignNode = PrimitiveNode;

export type CollectionItem = Record<string, unknown>;

export interface CollectionQuery {
  typeSlug?: string;
    /**
     * Selects a non-content data source (e.g. `"inventory:products"`). The host's
     * PrimitiveRenderContext decides what a source means; when unset, the source is
     * the engine's published content entries.
     */
    source?: string;
  limit?: number;
  sortBy?: string;
  order?: "asc" | "desc";
}

/** Host-provided data access used by data primitives (e.g. CollectionList). */
export interface PrimitiveRenderContext {
  listPublished(query: CollectionQuery): Promise<CollectionItem[]>;
}

export interface RenderResult {
  html: string;
  css: string;
}
