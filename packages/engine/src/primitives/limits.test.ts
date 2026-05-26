import {describe, expect, it} from "vitest";
import {PressError} from "@pressh/core";
import type {PrimitiveNode} from "@pressh/engine";
import {
    assertTreeWithinLimits,
    createBlockRegistry,
    MAX_TREE_DEPTH,
    MAX_TREE_NODES,
    renderTree,
    sanitizeBlocks,
} from "@pressh/engine";

/** A single root whose subtree is `count - 1` flat children (depth 2, count total). */
function wideTree(count: number): PrimitiveNode[] {
    const children: PrimitiveNode[] = [];
    for (let i = 0; i < count - 1; i++) children.push({id: `c${i}`, type: "text"});
    return [{id: "root", type: "container", children}];
}

/** A linear chain of containers `depth` levels deep (built iteratively). */
function deepTree(depth: number): PrimitiveNode[] {
    let node: PrimitiveNode = {id: "leaf", type: "text"};
    for (let i = 0; i < depth - 1; i++) node = {id: `n${i}`, type: "container", children: [node]};
    return [node];
}

/** Runs `fn`, returning the thrown error (or undefined if it did not throw). */
function caught(fn: () => unknown): unknown {
    try {
        fn();
    } catch (e) {
        return e;
    }
    return undefined;
}

describe("assertTreeWithinLimits", () => {
    it("accepts a small, valid tree", () => {
        expect(() => assertTreeWithinLimits(wideTree(10))).not.toThrow();
        expect(() => assertTreeWithinLimits(deepTree(10))).not.toThrow();
    });

    it("ignores non-array / empty input", () => {
        expect(() => assertTreeWithinLimits(undefined)).not.toThrow();
        expect(() => assertTreeWithinLimits(null)).not.toThrow();
        expect(() => assertTreeWithinLimits("nope")).not.toThrow();
        expect(() => assertTreeWithinLimits([])).not.toThrow();
    });

    it("rejects a tree over the node-count cap with a validation error", () => {
        const err = caught(() => assertTreeWithinLimits(wideTree(MAX_TREE_NODES + 2)));
        expect(err).toBeInstanceOf(PressError);
        expect((err as PressError).code).toBe("validation");
        expect((err as PressError).message).toMatch(/too large/i);
    });

    it("rejects a tree over the nesting-depth cap with a validation error", () => {
        const err = caught(() => assertTreeWithinLimits(deepTree(MAX_TREE_DEPTH + 5)));
        expect(err).toBeInstanceOf(PressError);
        expect((err as PressError).code).toBe("validation");
        expect((err as PressError).message).toMatch(/too deeply/i);
    });

    it("honours custom limits", () => {
        expect(() => assertTreeWithinLimits(wideTree(20), {maxNodes: 10})).toThrow(PressError);
        expect(() => assertTreeWithinLimits(deepTree(8), {maxDepth: 5})).toThrow(PressError);
        // Generous custom limits let an otherwise-rejected tree through.
        expect(() =>
            assertTreeWithinLimits(wideTree(20), {maxNodes: 100, maxDepth: 100}),
        ).not.toThrow();
    });

    it("does NOT stack-overflow validating a pathologically deep tree", () => {
        // The defining property of the fix: the validator is iterative, so even a
        // 200k-deep chain is rejected with a clean validation error — never a
        // RangeError ("Maximum call stack size exceeded").
        const err = caught(() => assertTreeWithinLimits(deepTree(200_000)));
        expect(err).toBeInstanceOf(PressError);
        expect((err as PressError).code).toBe("validation");
    });

    it("bounds work even when a single node declares a huge children array", () => {
        // The budget is charged on discovery, so the work stack never grows past the
        // cap regardless of one giant sibling list.
        const err = caught(() => assertTreeWithinLimits(wideTree(1_000_000)));
        expect(err).toBeInstanceOf(PressError);
        expect((err as PressError).code).toBe("validation");
    });
});

describe("renderTree — DoS guard", () => {
    it("renders a normal tree", async () => {
        const {html} = await renderTree(wideTree(5));
        expect(html).toContain("pst-container");
    });

    it("throws validation (not a stack overflow) on an over-deep tree before rendering", async () => {
        await expect(renderTree(deepTree(200_000))).rejects.toMatchObject({code: "validation"});
    });

    it("throws validation on an over-large tree", async () => {
        await expect(renderTree(wideTree(MAX_TREE_NODES + 2))).rejects.toBeInstanceOf(PressError);
    });
});

describe("designer-layout block — save-time guard", () => {
    const CAPS = {capabilities: [] as string[]};

    it("stores a normal layout's nodes", () => {
        const registry = createBlockRegistry();
        const out = sanitizeBlocks(
            registry,
            [{type: "designer-layout", props: {nodes: wideTree(5)}}],
            CAPS,
        );
        expect(out[0]?.type).toBe("designer-layout");
        expect(Array.isArray((out[0]?.props as { nodes: unknown[] }).nodes)).toBe(true);
    });

    it("rejects saving an over-large layout tree", () => {
        const registry = createBlockRegistry();
        const err = caught(() =>
            sanitizeBlocks(
                registry,
                [{type: "designer-layout", props: {nodes: wideTree(MAX_TREE_NODES + 2)}}],
                CAPS,
            ),
        );
        expect(err).toBeInstanceOf(PressError);
        expect((err as PressError).code).toBe("validation");
    });

    it("rejects saving an over-deep layout tree", () => {
        const registry = createBlockRegistry();
        const err = caught(() =>
            sanitizeBlocks(
                registry,
                [{type: "designer-layout", props: {nodes: deepTree(MAX_TREE_DEPTH + 5)}}],
                CAPS,
            ),
        );
        expect(err).toBeInstanceOf(PressError);
        expect((err as PressError).code).toBe("validation");
    });
});
