/** A single content block. `content` holds (sanitized) HTML for text blocks. */
export interface BlockNode {
  type: string;
  props?: Record<string, unknown>;
  content?: string;
  children?: BlockNode[];
}

export interface BlockDefinition {
  type: string;
  /** Capability required to USE this block at all (e.g. raw HTML). */
  requiredCapability?: string;
  /** Returns a sanitized copy of the block. Must never trust input. */
  sanitize(block: BlockNode): BlockNode;
}

export interface BlockRegistry {
  register(def: BlockDefinition): void;
  get(type: string): BlockDefinition | undefined;
  has(type: string): boolean;
  disable(type: string): void;
  enable(type: string): void;
  isDisabled(type: string): boolean;
}
