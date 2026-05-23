import type { ComponentContext, LayoutNode } from "./types.js";
import type { ComponentRegistry } from "./registry.js";

/**
 * Collects CSS from all registered component definitions that appear in the
 * given layout tree (de-duped by component ID).
 */
export function collectStyles(nodes: LayoutNode[], registry: ComponentRegistry): string {
  const seen = new Set<string>();
  const styles: string[] = [];

  function walk(n: LayoutNode): void {
    if (!seen.has(n.componentId)) {
      seen.add(n.componentId);
      const def = registry.get(n.componentId);
      if (def?.styles) styles.push(def.styles.trim());
    }
    n.children?.forEach(walk);
  }

  nodes.forEach(walk);
  return styles.join("\n");
}

/**
 * Renders a layout tree to HTML. Server components have their `serverData`
 * awaited sequentially before rendering (order preserved).
 */
export async function renderLayout(
  nodes: LayoutNode[],
  registry: ComponentRegistry,
  ctx: ComponentContext,
): Promise<string> {
  const parts: string[] = [];

  for (const node of nodes) {
    const def = registry.get(node.componentId);
    if (!def) {
      parts.push(`<!-- unknown component: ${node.componentId} -->`);
      continue;
    }

    let serverData: Record<string, unknown> = {};
    if (def.serverData) {
      try {
        serverData = await def.serverData(node.props, ctx);
      } catch {
        serverData = {};
      }
    }

    parts.push(def.render(node.props, serverData));

    if (node.children?.length) {
      parts.push(await renderLayout(node.children, registry, ctx));
    }
  }

  return parts.join("\n");
}
