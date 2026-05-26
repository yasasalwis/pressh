// Pure-ish helpers for the designer's primitive node tree. The tree is mutated
// in place by the editor (like the original imperative designer) and re-rendered
// via a version bump; these helpers locate / clone / move nodes within it.

export interface PNode {
    id: string;
    type: string;
    props?: Record<string, unknown>;
    bindings?: Record<string, unknown>;
    styles?: { base?: { default?: Record<string, string> } };
    children?: PNode[];
}

export interface PrimDef {
    type: string;
    name: string;
    icon: string;
    category: string;
    description?: string;
    isContainer?: boolean;
    defaultProps?: Record<string, unknown>;
    defaultStyles?: Record<string, unknown>;
}

export interface Preset {
    id: string;
    name: string;
    icon: string;
    category: string;
    description?: string;
    template: PNode[];
}

export function uid(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export interface Found {
    node: PNode;
    arr: PNode[];
    index: number;
    parent: PNode | null;
}

export function findNode(id: string, nodes: PNode[], parent: PNode | null = null): Found | null {
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        if (n.id === id) return {node: n, arr: nodes, index: i, parent};
        if (n.children) {
            const f = findNode(id, n.children, n);
            if (f) return f;
        }
    }
    return null;
}

/** Deep-clones a node list, assigning fresh ids throughout. */
export function cloneTree(nodes: PNode[]): PNode[] {
    const c = (n: PNode): PNode => {
        const o: PNode = {id: uid(), type: n.type};
        if (n.props) o.props = JSON.parse(JSON.stringify(n.props));
        if (n.bindings) o.bindings = JSON.parse(JSON.stringify(n.bindings));
        if (n.styles) o.styles = JSON.parse(JSON.stringify(n.styles));
        if (n.children) o.children = n.children.map(c);
        return o;
    };
    return nodes.map(c);
}

export function isDescendant(layout: PNode[], ancestorId: string, childId: string): boolean {
    const f = findNode(ancestorId, layout);
    if (!f || !f.node.children) return false;
    const has = (nodes: PNode[]): boolean => {
        for (const n of nodes) {
            if (n.id === childId) return true;
            if (n.children && has(n.children)) return true;
        }
        return false;
    };
    return has(f.node.children);
}

// ── style getters/setters (node.styles.base.default) ──
export function styleVal(node: PNode, key: string): string | undefined {
    return node.styles?.base?.default?.[key];
}

export function setStyleVal(node: PNode, key: string, val: string): void {
    node.styles = node.styles || {};
    node.styles.base = node.styles.base || {};
    node.styles.base.default = node.styles.base.default || {};
    if (val === "" || val == null) delete node.styles.base.default[key];
    else node.styles.base.default[key] = val;
}
