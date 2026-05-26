import {PressError} from "@pressh/core";

/**
 * Hard caps on the size of a primitive (designer) node tree.
 *
 * The tree is attacker-influenced: an editor authors it, it is stored verbatim
 * in a `designer-layout` block's `props.nodes`, and is then re-rendered on every
 * public page request (and on the studio preview endpoint). Without a bound, a
 * deeply nested or very large tree would exhaust CPU or blow the call stack
 * during the recursive render + CSS-compile passes — a denial of service that an
 * editor can author once and every anonymous visitor then amplifies on each
 * cache miss.
 *
 * The caps are enforced in two places:
 *  - at SAVE time (the `designer-layout` block sanitizer) so a pathological tree
 *    is never stored, and
 *  - at RENDER time (`renderTree`) as defense in depth: it covers already-stored
 *    data and the preview endpoint regardless of how the nodes arrived.
 *
 * Values are deliberately generous — a complex real-world page is a few hundred
 * nodes and never nests anywhere near 50 levels — so legitimate designs are
 * unaffected while pathological ones are rejected.
 */
export const MAX_TREE_NODES = 5000;
export const MAX_TREE_DEPTH = 50;

export interface TreeLimits {
    maxNodes?: number;
    maxDepth?: number;
}

/**
 * Asserts a primitive tree is within the node-count and nesting-depth caps,
 * throwing a `validation` {@link PressError} (→ HTTP 400) if it is not.
 *
 * The traversal is ITERATIVE (an explicit work stack), never recursive, so the
 * validator itself cannot stack-overflow on the very deeply-nested input it
 * exists to reject. The node budget is charged as each node is *discovered*
 * (pushed), so the work stack can never grow past `maxNodes` even if a single
 * node declares millions of children — the limit fires before they are queued.
 *
 * Input is untrusted and possibly malformed, so non-object entries are tolerated
 * (they still count toward the budget) and `children` is only descended when it
 * is genuinely an array.
 */
export function assertTreeWithinLimits(nodes: unknown, limits: TreeLimits = {}): void {
    const maxNodes = limits.maxNodes ?? MAX_TREE_NODES;
    const maxDepth = limits.maxDepth ?? MAX_TREE_DEPTH;
    if (!Array.isArray(nodes)) return;

    const stack: Array<{ node: unknown; depth: number }> = [];
    let count = 0;

    const enqueue = (arr: unknown[], depth: number): void => {
        if (depth > maxDepth) {
            throw new PressError("validation", `Layout is nested too deeply (over ${maxDepth} levels)`, {
                maxDepth,
            });
        }
        for (const node of arr) {
            count += 1;
            if (count > maxNodes) {
                throw new PressError("validation", `Layout is too large (over ${maxNodes} nodes)`, {
                    maxNodes,
                });
            }
            stack.push({node, depth});
        }
    };

    enqueue(nodes, 1);
    while (stack.length > 0) {
        const {node, depth} = stack.pop() as { node: unknown; depth: number };
        if (typeof node !== "object" || node === null) continue;
        const children = (node as { children?: unknown }).children;
        if (Array.isArray(children)) enqueue(children, depth + 1);
    }
}
