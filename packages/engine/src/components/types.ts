export type ComponentPropType =
  | "text"
  | "richtext"
  | "number"
  | "boolean"
  | "select"
  | "color"
  | "image-url";

export interface ComponentPropDef {
  type: ComponentPropType;
  label: string;
  default?: unknown;
  options?: string[];
  placeholder?: string;
  min?: number;
  max?: number;
}

export interface ComponentContext {
  fetchContent(slug: string): Promise<Record<string, unknown> | null>;
  listPublished(limit?: number): Promise<Array<Record<string, unknown>>>;
}

export interface ComponentDef {
  id: string;
  name: string;
  category: "layout" | "content" | "media" | "data";
  description: string;
  icon: string;
  props: Record<string, ComponentPropDef>;
  defaultProps: Record<string, unknown>;
  serverData?(
    props: Record<string, unknown>,
    ctx: ComponentContext,
  ): Promise<Record<string, unknown>>;
  render(props: Record<string, unknown>, serverData: Record<string, unknown>): string;
  styles?: string;
}

export interface LayoutNode {
  id: string;
  componentId: string;
  props: Record<string, unknown>;
  children?: LayoutNode[];
}

export const DESIGNER_LAYOUT_BLOCK = "designer-layout";
