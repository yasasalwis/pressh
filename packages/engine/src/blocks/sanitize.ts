import { CapabilityGate, PressError } from "@pressh/core";
import type { BlockNode, BlockRegistry } from "./types.js";

/** Block type emitted when an incoming block is unknown, disabled, or malformed. */
export const FALLBACK_BLOCK_TYPE = "unsupported";

const gate = new CapabilityGate();

function asBlockNode(raw: unknown): BlockNode | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["type"] !== "string") return null;
  const node: BlockNode = { type: obj["type"] };
  if (typeof obj["content"] === "string") node.content = obj["content"];
  if (typeof obj["props"] === "object" && obj["props"] !== null) {
    node.props = obj["props"] as Record<string, unknown>;
  }
  if (Array.isArray(obj["children"])) node.children = obj["children"] as BlockNode[];
  return node;
}

/**
 * Sanitizes an untrusted block array against the registry:
 *  - unknown / disabled / malformed blocks become a safe fallback block,
 *  - blocks requiring a capability the actor lacks throw (the save is rejected),
 *  - every other block is run through its registered sanitizer (recursively).
 */
export function sanitizeBlocks(
  registry: BlockRegistry,
  blocks: unknown[],
  ctx: { capabilities: string[] },
): BlockNode[] {
  const out: BlockNode[] = [];
  for (const raw of blocks) {
    const block = asBlockNode(raw);
    if (!block) {
      out.push({ type: FALLBACK_BLOCK_TYPE, props: { reason: "malformed" } });
      continue;
    }
    const def = registry.get(block.type);
    if (!def || registry.isDisabled(block.type)) {
      out.push({ type: FALLBACK_BLOCK_TYPE, props: { originalType: block.type } });
      continue;
    }
    if (def.requiredCapability && !gate.check(ctx.capabilities, def.requiredCapability)) {
      throw new PressError(
        "capability_denied",
        `Block "${block.type}" requires capability ${def.requiredCapability}`,
        { block: block.type, required: def.requiredCapability },
      );
    }
    const sanitized = def.sanitize(block);
    if (block.children) {
      sanitized.children = sanitizeBlocks(registry, block.children, ctx);
    }
    out.push(sanitized);
  }
  return out;
}
