import {useEffect, useReducer, useRef, useState, type CSSProperties} from "react";
import {api} from "../../api";
import {Loading} from "../ui";
import {
    cloneTree,
    findNode,
    isDescendant,
    setStyleVal,
    styleVal,
    uid,
    type PNode,
    type PrimDef,
    type Preset,
} from "./tree";
import {COLOR_OPTS, SPACE_OPTS, STYLE_PRESETS, contentFields, type ContentField} from "./fields";

const PRIM_CATS: [string, string][] = [
    ["layout", "Layout"],
    ["content", "Content"],
    ["data", "Data"],
    ["form", "Forms"],
];

interface DState {
    layout: PNode[];
    fields: Record<string, unknown>;
    selected: string | null;
    prims: PrimDef[];
    presets: Preset[];
    tokens: Record<string, string>;
    editingSlug: string;
    editingStatus: string;
    device: "desktop" | "tablet" | "mobile";
    showBorders: boolean;
    paletteQuery: string;
    history: string[];
    histIdx: number;
    dirty: boolean;
    propTab: "content" | "layout";
    layersCollapsed: Record<string, boolean>;
    drag: { kind: string; id: string } | null;
    dragNode: string | null;
}

export function Designer({pageId, onClose}: { pageId: string; onClose: () => void }) {
    const D = useRef<DState>({
        layout: [],
        fields: {},
        selected: null,
        prims: [],
        presets: [],
        tokens: {},
        editingSlug: "",
        editingStatus: "",
        device: "desktop",
        showBorders: false,
        paletteQuery: "",
        history: [],
        histIdx: -1,
        dirty: false,
        propTab: "content",
        layersCollapsed: {},
        drag: null,
        dragNode: null,
    }).current;

    const [, bump] = useReducer((x: number) => x + 1, 0);
    const [ready, setReady] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [canvas, setCanvas] = useState<{ html: string; css: string }>({html: "", css: ""});
    const [saveStatus, setSaveStatus] = useState("");
    const [busy, setBusy] = useState(false);

    const liveRef = useRef<HTMLDivElement>(null);
    const canvasInnerRef = useRef<HTMLDivElement>(null);
    const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const histTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── helpers ───────────────────────────────────────────────────────
    const defFor = (type: string): PrimDef | null => D.prims.find((p) => p.type === type) || null;
    const isContainer = (type: string): boolean => !!defFor(type)?.isContainer;

    function childrenOf(nid: string): PNode[] {
        const f = findNode(nid, D.layout);
        if (!f) return D.layout;
        if (isContainer(f.node.type)) {
            f.node.children = f.node.children || [];
            return f.node.children;
        }
        if (f.parent) {
            f.parent.children = f.parent.children || [];
            return f.parent.children;
        }
        return D.layout;
    }

    async function renderCanvas() {
        if (!D.layout.length) {
            setCanvas({html: "", css: ""});
            return;
        }
        try {
            const r = await api<{ html?: string; css?: string }>("/admin/api/preview/render", {
                method: "POST",
                body: JSON.stringify({nodes: D.layout}),
            });
            if (r.status !== 200) {
                setCanvas({html: "<div class='dc-empty'>Preview failed.</div>", css: ""});
                return;
            }
            setCanvas({html: r.body.html || "", css: r.body.css || ""});
        } catch {
            setCanvas({html: "<div class='dc-empty'>Preview failed.</div>", css: ""});
        }
    }

    function scheduleRender() {
        if (renderTimer.current) clearTimeout(renderTimer.current);
        renderTimer.current = setTimeout(() => void renderCanvas(), 180);
    }

    function pushHist() {
        D.history = D.history.slice(0, D.histIdx + 1);
        D.history.push(JSON.stringify(D.layout));
        D.histIdx = D.history.length - 1;
        if (D.history.length > 80) {
            D.history.shift();
            D.histIdx--;
        }
        D.dirty = true;
    }

    function scheduleHist() {
        if (histTimer.current) clearTimeout(histTimer.current);
        histTimer.current = setTimeout(() => pushHist(), 500);
    }

    /** Structural change: record history, re-render canvas + panels. */
    function commit() {
        pushHist();
        void renderCanvas();
        bump();
    }

    /** Prop/style edit: mark dirty, debounce canvas + history (no full re-render). */
    function propChanged() {
        D.dirty = true;
        scheduleRender();
        scheduleHist();
    }

    // ── mutations ─────────────────────────────────────────────────────
    function addFromPalette(kind: string, id: string, targetNid?: string | null, fromDrop?: boolean) {
        let nodes: PNode[];
        if (kind === "preset") {
            const p = D.presets.find((x) => x.id === id);
            if (!p) return;
            nodes = cloneTree(p.template);
        } else {
            const def = defFor(id);
            if (!def) return;
            const node: PNode = {id: uid(), type: id};
            if (def.defaultProps) node.props = JSON.parse(JSON.stringify(def.defaultProps));
            if (def.defaultStyles) node.styles = JSON.parse(JSON.stringify(def.defaultStyles));
            if (def.isContainer) node.children = [];
            nodes = [node];
        }
        let arr: PNode[];
        if (fromDrop) arr = targetNid ? childrenOf(targetNid) : D.layout;
        else if (kind === "preset") arr = D.layout;
        else arr = D.selected ? childrenOf(D.selected) : D.layout;
        for (const n of nodes) arr.push(n);
        D.selected = nodes[0]!.id;
        commit();
    }

    function moveInto(dragId: string, containerId: string | null) {
        if (dragId === containerId || (containerId && isDescendant(D.layout, dragId, containerId))) return;
        const df = findNode(dragId, D.layout);
        if (!df) return;
        const node = df.arr.splice(df.index, 1)[0]!;
        const arr = containerId ? childrenOf(containerId) : D.layout;
        arr.push(node);
        D.selected = node.id;
        commit();
    }

    function moveAfter(dragId: string, targetId: string) {
        if (dragId === targetId || isDescendant(D.layout, dragId, targetId)) return;
        const df = findNode(dragId, D.layout);
        if (!df) return;
        const node = df.arr.splice(df.index, 1)[0]!;
        const tf = findNode(targetId, D.layout);
        if (!tf) D.layout.push(node);
        else tf.arr.splice(tf.index + 1, 0, node);
        D.selected = node.id;
        commit();
    }

    function moveNode(id: string, dir: number) {
        const f = findNode(id, D.layout);
        if (!f) return;
        const j = f.index + dir;
        if (j < 0 || j >= f.arr.length) return;
        const t = f.arr[f.index]!;
        f.arr[f.index] = f.arr[j]!;
        f.arr[j] = t;
        commit();
    }

    function duplicateNode(id: string) {
        const f = findNode(id, D.layout);
        if (!f) return;
        const clone = cloneTree([f.node])[0]!;
        f.arr.splice(f.index + 1, 0, clone);
        D.selected = clone.id;
        commit();
    }

    function removeNode(id: string) {
        const f = findNode(id, D.layout);
        if (!f) return;
        f.arr.splice(f.index, 1);
        if (D.selected === id) D.selected = f.parent ? f.parent.id : null;
        commit();
    }

    function selectNode(id: string | null) {
        D.selected = id;
        bump();
    }

    // ── drop-target highlighting (transient DOM classes) ──
    function clearDropTarget() {
        canvasInnerRef.current?.classList.remove("ds-dragover");
        liveRef.current?.querySelectorAll(".ds-drop-target").forEach((e) => e.classList.remove("ds-drop-target"));
    }

    function dropTargetFor(target: EventTarget | null): HTMLElement | null {
        let e = target instanceof Element ? target.closest("[data-nid]") : null;
        while (e) {
            const f = findNode(e.getAttribute("data-nid") || "", D.layout);
            if (f && isContainer(f.node.type)) return e as HTMLElement;
            e = e.parentElement ? e.parentElement.closest("[data-nid]") : null;
        }
        return null;
    }

    function setDropTarget(node: HTMLElement | null) {
        clearDropTarget();
        if (node) node.classList.add("ds-drop-target");
        else canvasInnerRef.current?.classList.add("ds-dragover");
    }

    // ── load ──────────────────────────────────────────────────────────
    useEffect(() => {
        let alive = true;
        (async () => {
            const lib = await api<{
                primitives?: PrimDef[];
                presets?: Preset[];
                themes?: { tokens?: { key: string; default: string }[] }[]
            }>(
                "/admin/api/designer/library",
            );
            if (!alive) return;
            D.prims = lib.body.primitives || [];
            D.presets = lib.body.presets || [];
            const tk: Record<string, string> = {};
            const themeTokens = lib.body.themes?.[0]?.tokens;
            if (themeTokens) for (const t of themeTokens) tk[t.key] = t.default;
            D.tokens = tk;

            const r = await api<{
                entry?: { slug: string; status: string };
                revision?: {
                    blocks?: { type: string; props?: { nodes?: PNode[] } }[];
                    fields?: Record<string, unknown>
                }
            }>(
                "/admin/api/content/" + pageId,
            );
            if (!alive) return;
            if (r.status !== 200 || !r.body.entry) {
                setLoadError("Could not load this page.");
                return;
            }
            D.editingSlug = r.body.entry.slug;
            D.editingStatus = r.body.entry.status;
            D.fields = r.body.revision?.fields || {};
            const blocks = r.body.revision?.blocks || [];
            const lb = blocks.find((b) => b.type === "designer-layout");
            D.layout = Array.isArray(lb?.props?.nodes) ? lb!.props!.nodes! : [];
            D.history = [JSON.stringify(D.layout)];
            D.histIdx = 0;
            D.dirty = false;
            setReady(true);
            void renderCanvas();
        })();
        return () => {
            alive = false;
        };
    }, [pageId]);

    // Keyboard shortcuts (undo/redo/escape/delete).
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            const tag = document.activeElement?.tagName || "";
            const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
                e.preventDefault();
                undo();
            } else if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === "z" || e.key === "Z")) || e.key === "y" || e.key === "Y")) {
                e.preventDefault();
                redo();
            } else if (e.key === "Escape") {
                if (D.selected) selectNode(null);
            } else if ((e.key === "Delete" || e.key === "Backspace") && D.selected && !typing) {
                e.preventDefault();
                removeNode(D.selected);
            }
        }

        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    // Apply selection outline to the server-rendered canvas after each render.
    useEffect(() => {
        const live = liveRef.current;
        if (!live) return;
        live.querySelectorAll(".ds-sel").forEach((e) => e.classList.remove("ds-sel"));
        if (D.selected) live.querySelector(`[data-nid="${D.selected}"]`)?.classList.add("ds-sel");
    });

    function undo() {
        if (D.histIdx <= 0) return;
        D.histIdx--;
        D.layout = JSON.parse(D.history[D.histIdx]!) as PNode[];
        if (D.selected && !findNode(D.selected, D.layout)) D.selected = null;
        D.dirty = true;
        void renderCanvas();
        bump();
    }

    function redo() {
        if (D.histIdx >= D.history.length - 1) return;
        D.histIdx++;
        D.layout = JSON.parse(D.history[D.histIdx]!) as PNode[];
        if (D.selected && !findNode(D.selected, D.layout)) D.selected = null;
        D.dirty = true;
        void renderCanvas();
        bump();
    }

    async function save(publish: boolean) {
        setBusy(true);
        setSaveStatus("Saving…");
        const blocks = [{type: "designer-layout", props: {nodes: D.layout}}];
        const r = await api("/admin/api/content/" + pageId, {
            method: "PUT",
            body: JSON.stringify({fields: D.fields, blocks}),
        });
        if (r.status !== 200) {
            setBusy(false);
            setSaveStatus("Save failed ✗");
            setTimeout(() => setSaveStatus(""), 3000);
            return;
        }
        D.dirty = false;
        if (publish) {
            await api("/admin/api/content/" + pageId + "/publish", {method: "POST", body: "{}"});
            D.editingStatus = "published";
            setSaveStatus("Published ✓");
        } else {
            setSaveStatus("Saved ✓");
        }
        setBusy(false);
        setTimeout(() => setSaveStatus(""), 2500);
    }

    function back() {
        if (D.dirty && !confirm("You have unsaved changes. Leave the designer and discard them?")) return;
        onClose();
    }

    if (loadError)
        return (
            <div className="ds-shell">
                <div className="dp-empty" style={{height: "100%"}}>
                    <p className="dp-empty-title">{loadError}</p>
                    <button className="btn-sm" onClick={onClose}>
                        Back to pages
                    </button>
                </div>
            </div>
        );
    if (!ready)
        return (
            <div className="ds-shell">
                <Loading/>
            </div>
        );

    const tokenStyle: CSSProperties = {};
    for (const k in D.tokens) (tokenStyle as Record<string, string>)["--" + k] = D.tokens[k]!;

    return (
        <div className="ds-shell">
            <div className="ds-topbar">
                <div className="logo">P</div>
                <button className="ds-back" onClick={back}>
                    ← Back
                </button>
                <span className="ds-page-slug">/{D.editingSlug}</span>
                <div className="ds-sep"/>
                {(["desktop", "tablet", "mobile"] as const).map((dv) => (
                    <button
                        key={dv}
                        className={"ds-device-btn" + (D.device === dv ? " active" : "")}
                        onClick={() => {
                            D.device = dv;
                            bump();
                        }}
                        title={dv}
                    >
                        {dv === "desktop" ? "🖥" : dv === "tablet" ? "▭" : "📱"}
                    </button>
                ))}
                <div className="ds-sep"/>
                <button className="ds-undo-btn" onClick={undo} title="Undo (Ctrl+Z)">
                    ↩ Undo
                </button>
                <button className="ds-undo-btn" onClick={redo} title="Redo (Ctrl+Y)">
                    ↪ Redo
                </button>
                <div className="ds-sep"/>
                <button
                    className={"ds-undo-btn" + (D.showBorders ? " active" : "")}
                    onClick={() => {
                        D.showBorders = !D.showBorders;
                        bump();
                    }}
                    title="Show element outlines"
                >
                    ▭ Outlines
                </button>
                <div className="spacer"/>
                <span className="ds-save-status">{saveStatus}</span>
                <button
                    className="ghost"
                    style={{fontSize: ".8rem"}}
                    onClick={() => window.open(location.protocol + "//" + location.hostname + ":3000/" + D.editingSlug, "_blank")}
                >
                    Preview ↗
                </button>
                <button className="btn-sm" onClick={() => save(false)} disabled={busy}>
                    Save draft
                </button>
                <button className="btn-sm btn-ok" onClick={() => save(true)} disabled={busy}>
                    {D.editingStatus === "published" ? "Update & publish" : "Publish"}
                </button>
            </div>

            <div className="ds-body">
                <Palette D={D} onAdd={addFromPalette} onQuery={(q) => {
                    D.paletteQuery = q;
                    bump();
                }}/>

                <div className="ds-canvas-wrap">
                    <div className="ds-canvas-toolbar">
                        <span className="ds-canvas-label">Canvas</span>
                    </div>
                    <div className="ds-canvas-scroll">
                        <div
                            ref={canvasInnerRef}
                            className={"ds-canvas-inner dv-" + D.device}
                            onClick={(e) => {
                                const t = (e.target as Element).closest("[data-nid]");
                                if (!t) return;
                                e.preventDefault();
                                e.stopPropagation();
                                selectNode(t.getAttribute("data-nid"));
                            }}
                            onDragOver={(e) => {
                                if (!D.drag && !D.dragNode) return;
                                e.preventDefault();
                                setDropTarget(dropTargetFor(e.target));
                            }}
                            onDragLeave={(e) => {
                                if (e.target === canvasInnerRef.current) clearDropTarget();
                            }}
                            onDrop={(e) => {
                                if (!D.drag && !D.dragNode) {
                                    clearDropTarget();
                                    return;
                                }
                                e.preventDefault();
                                const tgt = dropTargetFor(e.target);
                                const nid = tgt ? tgt.getAttribute("data-nid") : null;
                                clearDropTarget();
                                if (D.dragNode) {
                                    moveInto(D.dragNode, nid);
                                    D.dragNode = null;
                                } else if (D.drag) {
                                    addFromPalette(D.drag.kind, D.drag.id, nid, true);
                                    D.drag = null;
                                }
                            }}
                        >
                            {!D.layout.length ? (
                                <div className="dc-empty">
                                    <div className="dc-empty-icon">＋</div>
                                    <div className="dc-empty-title">Your page is empty</div>
                                    <div className="dc-empty-sub">Click or drag a primitive or component from the left
                                        to start building.
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <style>{canvas.css}</style>
                                    <div
                                        ref={liveRef}
                                        className={"ds-live" + (D.showBorders ? " ds-show-outlines" : "")}
                                        style={tokenStyle}
                                        dangerouslySetInnerHTML={{__html: canvas.html}}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <RightPanel
                    D={D}
                    defFor={defFor}
                    isContainer={isContainer}
                    onSelect={selectNode}
                    onRerender={bump}
                    onPropChanged={propChanged}
                    onAction={(a) => {
                        if (!D.selected) return;
                        if (a === "up") moveNode(D.selected, -1);
                        else if (a === "down") moveNode(D.selected, 1);
                        else if (a === "dup") duplicateNode(D.selected);
                        else if (a === "del") removeNode(D.selected);
                        else if (a === "parent") {
                            const f = findNode(D.selected, D.layout);
                            if (f?.parent) selectNode(f.parent.id);
                        }
                    }}
                    onTab={(t) => {
                        D.propTab = t;
                        bump();
                    }}
                    onMove={moveInto}
                    onMoveAfter={moveAfter}
                />
            </div>
        </div>
    );
}

// ── Palette ──────────────────────────────────────────────────────────
function Palette({D, onAdd, onQuery}: {
    D: DState;
    onAdd: (k: string, id: string) => void;
    onQuery: (q: string) => void
}) {
    const q = D.paletteQuery.toLowerCase();
    const match = (name?: string, desc?: string) => !q || ((name || "") + " " + (desc || "")).toLowerCase().includes(q);

    const primGroups = PRIM_CATS.map(([cat, label]) => ({
        label,
        items: D.prims.filter((d) => d.category === cat && match(d.name, d.description)),
    })).filter((g) => g.items.length);

    const presetCats: { name: string; items: Preset[] }[] = [];
    for (const pr of D.presets) {
        if (!match(pr.name, pr.description)) continue;
        let g = presetCats.find((c) => c.name === pr.category);
        if (!g) {
            g = {name: pr.category, items: []};
            presetCats.push(g);
        }
        g.items.push(pr);
    }

    const empty = !primGroups.length && !presetCats.length;

    function dragStart(e: React.DragEvent, kind: string, id: string) {
        D.drag = {kind, id};
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "copy";
            try {
                e.dataTransfer.setData("text/plain", id);
            } catch {
                /* ignore */
            }
        }
    }

    function Item({kind, id, icon, name, desc}: {
        kind: string;
        id: string;
        icon: string;
        name: string;
        desc?: string
    }) {
        return (
            <div
                className={"ds-pl-item" + (kind === "preset" ? " ds-pl-preset" : "")}
                draggable
                title={desc || ""}
                onClick={() => onAdd(kind, id)}
                onDragStart={(e) => dragStart(e, kind, id)}
                onDragEnd={() => {
                    D.drag = null;
                }}
            >
                <span className="ds-pl-ic">{icon}</span>
                <span className="ds-pl-nm">{name}</span>
            </div>
        );
    }

    return (
        <div className="ds-left">
            <div className="ds-panel-head">
                <span className="ds-panel-title">Add</span>
                <span
                    style={{fontSize: ".7rem", color: "var(--muted)"}}>{D.prims.length + D.presets.length} blocks</span>
            </div>
            <div className="ds-left-search">
                <input type="text" placeholder="Search blocks…" value={D.paletteQuery}
                       onChange={(e) => onQuery(e.target.value)}/>
            </div>
            <div className="ds-palette">
                {empty ? (
                    <div className="empty" style={{fontSize: ".8rem", padding: ".75rem .25rem"}}>
                        No matches
                    </div>
                ) : (
                    <>
                        {primGroups.map((g) => (
                            <details className="ds-pl-group" open key={g.label}>
                                <summary>
                                    {g.label}
                                    <span className="ds-pl-n">{g.items.length}</span>
                                </summary>
                                <div className="ds-pl-items">
                                    {g.items.map((d) => (
                                        <Item key={d.type} kind="prim" id={d.type} icon={d.icon} name={d.name}
                                              desc={d.description}/>
                                    ))}
                                </div>
                            </details>
                        ))}
                        {presetCats.length > 0 && <div className="ds-pl-sep">Components</div>}
                        {presetCats.map((c) => (
                            <details className="ds-pl-group" open key={c.name}>
                                <summary>
                                    {c.name}
                                    <span className="ds-pl-n">{c.items.length}</span>
                                </summary>
                                <div className="ds-pl-items">
                                    {c.items.map((p) => (
                                        <Item key={p.id} kind="preset" id={p.id} icon={p.icon} name={p.name}
                                              desc={p.description}/>
                                    ))}
                                </div>
                            </details>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}

// ── Right panel: Layers + Properties ─────────────────────────────────
function RightPanel({
                        D,
                        defFor,
                        isContainer,
                        onSelect,
                        onRerender,
                        onPropChanged,
                        onAction,
                        onTab,
                        onMove,
                        onMoveAfter,
                    }: {
    D: DState;
    defFor: (t: string) => PrimDef | null;
    isContainer: (t: string) => boolean;
    onSelect: (id: string | null) => void;
    onRerender: () => void;
    onPropChanged: () => void;
    onAction: (a: string) => void;
    onTab: (t: "content" | "layout") => void;
    onMove: (drag: string, container: string | null) => void;
    onMoveAfter: (drag: string, target: string) => void;
}) {
    const sel = D.selected ? findNode(D.selected, D.layout) : null;
    return (
        <div className="ds-right">
            <div className="ds-rp-layers">
                <div className="ds-panel-head">
                    <span className="ds-panel-title">Layers</span>
                </div>
                <div className="ds-layers-scroll">
                    <Layers D={D} defFor={defFor} isContainer={isContainer} onSelect={onSelect} onRerender={onRerender}
                            onMove={onMove} onMoveAfter={onMoveAfter}/>
                </div>
            </div>
            <div className="ds-rp-divider hide"/>
            <div className="ds-rp-props">
                <div className="ds-panel-head">
                    <span className="ds-panel-title">Properties</span>
                    <span style={{
                        fontSize: ".7rem",
                        color: "var(--muted)"
                    }}>{sel ? defFor(sel.node.type)?.name || sel.node.type : ""}</span>
                </div>
                <div className="ds-props-scroll">
                    {!sel ? (
                        <div className="dp-empty">
                            <div className="dp-empty-icon">⛶</div>
                            <p className="dp-empty-title">Nothing selected</p>
                            <p className="dp-empty-sub">Click an element on the canvas or in Layers to edit it.</p>
                        </div>
                    ) : (
                        <Properties key={sel.node.id} D={D} found={sel} defFor={defFor} isContainer={isContainer}
                                    onPropChanged={onPropChanged} onTab={onTab} onAction={onAction}/>
                    )}
                </div>
            </div>
        </div>
    );
}

function Layers({
                    D,
                    defFor,
                    isContainer,
                    onSelect,
                    onRerender,
                    onMove,
                    onMoveAfter,
                }: {
    D: DState;
    defFor: (t: string) => PrimDef | null;
    isContainer: (t: string) => boolean;
    onSelect: (id: string) => void;
    onRerender: () => void;
    onMove: (drag: string, container: string | null) => void;
    onMoveAfter: (drag: string, target: string) => void;
}) {
    if (!D.layout.length) return <div className="ds-layers-empty">No elements yet</div>;

    function label(n: PNode): string {
        const nm = defFor(n.type)?.name || n.type;
        const p = n.props || {};
        const txt = p["text"] || p["label"] || p["heading"] || p["alt"];
        return txt ? nm + " · " + String(txt).slice(0, 20) : nm;
    }

    const rows: React.ReactNode[] = [];
    const walk = (nodes: PNode[], depth: number) => {
        for (const n of nodes) {
            const ic = defFor(n.type)?.icon || "◦";
            const hasKids = !!(n.children && n.children.length);
            const coll = !!D.layersCollapsed[n.id];
            rows.push(
                <div
                    key={n.id}
                    className={"ds-lr" + (D.selected === n.id ? " sel" : "")}
                    draggable
                    style={{paddingLeft: depth * 14 + 6}}
                    onClick={() => onSelect(n.id)}
                    onDragStart={() => {
                        D.dragNode = n.id;
                    }}
                    onDragOver={(e) => {
                        if (D.dragNode) e.preventDefault();
                    }}
                    onDrop={(e) => {
                        if (!D.dragNode) return;
                        e.preventDefault();
                        const f = findNode(n.id, D.layout);
                        if (f) {
                            if (isContainer(f.node.type)) onMove(D.dragNode, n.id);
                            else onMoveAfter(D.dragNode, n.id);
                        }
                        D.dragNode = null;
                    }}
                >
          <span
              className={"ds-lr-caret" + (hasKids ? "" : " ds-lr-spacer")}
              onClick={(e) => {
                  if (!hasKids) return;
                  e.stopPropagation();
                  D.layersCollapsed[n.id] = !coll;
                  onRerender();
              }}
          >
            {hasKids ? (coll ? "▸" : "▾") : "•"}
          </span>
                    <span className="ds-lr-ic">{ic}</span>
                    <span className="ds-lr-nm">{label(n)}</span>
                </div>,
            );
            if (hasKids && !coll) walk(n.children!, depth + 1);
        }
    };
    walk(D.layout, 0);
    return <>{rows}</>;
}

// ── Properties ────────────────────────────────────────────────────────
function Properties({
                        D,
                        found,
                        defFor,
                        isContainer,
                        onPropChanged,
                        onTab,
                        onAction,
                    }: {
    D: DState;
    found: { node: PNode; parent: PNode | null };
    defFor: (t: string) => PrimDef | null;
    isContainer: (t: string) => boolean;
    onPropChanged: () => void;
    onTab: (t: "content" | "layout") => void;
    onAction: (a: string) => void;
}) {
    const node = found.node;
    const def = defFor(node.type);
    const name = def?.name || node.type;
    const ic = def?.icon || "◦";

    return (
        <>
            <div className="dp-comp-header">
                <div className="dp-comp-title">
                    <span>{ic}</span>
                    {name}
                </div>
                {found.parent && (
                    <button className="dp-parent" onClick={() => onAction("parent")}>
                        ↑ Select parent ({defFor(found.parent.type)?.name || found.parent.type})
                    </button>
                )}
            </div>
            <div className="dp-tabs">
                <button className={"dp-tab" + (D.propTab === "content" ? " active" : "")}
                        onClick={() => onTab("content")}>
                    Content
                </button>
                <button className={"dp-tab" + (D.propTab === "layout" ? " active" : "")}
                        onClick={() => onTab("layout")}>
                    Layout
                </button>
            </div>
            <div className="dp-props-form">
                {D.propTab === "layout" ? (
                    <LayoutTab node={node} container={isContainer(node.type)} onChange={onPropChanged}/>
                ) : (
                    <ContentTab node={node} onChange={onPropChanged}/>
                )}
            </div>
            <div className="dp-actions">
                <div className="dp-act-row">
                    <button className="ghost" onClick={() => onAction("up")}>
                        ↑ Up
                    </button>
                    <button className="ghost" onClick={() => onAction("down")}>
                        ↓ Down
                    </button>
                </div>
                <button className="ghost" onClick={() => onAction("dup")}>
                    ❖ Duplicate
                </button>
                <button className="ghost danger" onClick={() => onAction("del")}>
                    ✕ Remove
                </button>
            </div>
        </>
    );
}

function ContentField_({node, fld, onChange}: { node: PNode; fld: ContentField; onChange: () => void }) {
    const initial = node.props?.[fld.k];
    const [val, setVal] = useState<string | boolean>(fld.t === "checkbox" ? !!initial : initial == null ? "" : String(initial));

    function write(v: string | boolean) {
        setVal(v);
        node.props = node.props || {};
        node.props[fld.k] = fld.t === "number" ? Number(v) : v;
        onChange();
    }

    if (fld.t === "checkbox") {
        return (
            <div className="dp-field dp-check">
                <label>
                    <input type="checkbox" checked={val as boolean} onChange={(e) => write(e.target.checked)}/> {fld.l}
                </label>
            </div>
        );
    }
    return (
        <div className="dp-field">
            <label className="dp-label">{fld.l}</label>
            {fld.t === "textarea" ? (
                <textarea className="dp-in" rows={3} value={val as string} onChange={(e) => write(e.target.value)}/>
            ) : fld.t === "select" ? (
                <select className="dp-in" value={val as string} onChange={(e) => write(e.target.value)}>
                    {(fld.o || []).map((o) => (
                        <option key={o} value={o}>
                            {o}
                        </option>
                    ))}
                </select>
            ) : (
                <input className="dp-in" type={fld.t === "number" ? "number" : "text"} value={val as string}
                       onChange={(e) => write(e.target.value)}/>
            )}
        </div>
    );
}

function StyleField({
                        node,
                        label,
                        styleKey,
                        kind,
                        options,
                        placeholder,
                        onChange,
                    }: {
    node: PNode;
    label: string;
    styleKey: string;
    kind: "text" | "color" | "select";
    options?: string[];
    placeholder?: string;
    onChange: () => void;
}) {
    const [val, setVal] = useState<string>(styleVal(node, styleKey) ?? "");

    function write(v: string) {
        setVal(v);
        setStyleVal(node, styleKey, v);
        onChange();
    }

    const listId = "dl-" + styleKey;
    if (kind === "color") {
        const hex = /^#[0-9a-fA-F]{3,8}$/.test(val) ? val : "#888888";
        return (
            <div className="dp-field">
                <label className="dp-label">{label}</label>
                <div className="dp-color-row">
                    <input type="color" value={hex} onChange={(e) => write(e.target.value)}/>
                    <input className="dp-in" type="text" list={listId} value={val}
                           placeholder={placeholder || "#hex / token:colorPrimary"}
                           onChange={(e) => write(e.target.value)}/>
                </div>
                <datalist id={listId}>
                    {COLOR_OPTS.map((o) => (
                        <option key={o} value={o}/>
                    ))}
                </datalist>
            </div>
        );
    }
    if (kind === "select") {
        return (
            <div className="dp-field">
                <label className="dp-label">{label}</label>
                <select className="dp-in" value={val} onChange={(e) => write(e.target.value)}>
                    <option value="">default</option>
                    {(options || []).map((o) => (
                        <option key={o} value={o}>
                            {o}
                        </option>
                    ))}
                </select>
            </div>
        );
    }
    const presets = STYLE_PRESETS[styleKey];
    return (
        <div className="dp-field">
            <label className="dp-label">{label}</label>
            <input className="dp-in" type="text" list={presets ? listId : undefined} value={val}
                   placeholder={placeholder || ""} onChange={(e) => write(e.target.value)}/>
            {presets && (
                <datalist id={listId}>
                    {presets.map((o) => (
                        <option key={o} value={o}/>
                    ))}
                </datalist>
            )}
        </div>
    );
}

function BoxField({node, label, prefix, onChange}: {
    node: PNode;
    label: string;
    prefix: string;
    onChange: () => void
}) {
    const sides = ["Top", "Right", "Bottom", "Left"];
    const abbr = ["T", "R", "B", "L"];
    const listId = "dl-" + prefix;
    return (
        <div className="dp-field">
            <label className="dp-label">{label}</label>
            <div className="dp-box4">
                {sides.map((s, i) => (
                    <BoxSide key={s} node={node} styleKey={prefix + s} abbr={abbr[i]!} listId={listId}
                             onChange={onChange}/>
                ))}
            </div>
            <datalist id={listId}>
                {SPACE_OPTS.map((o) => (
                    <option key={o} value={o}/>
                ))}
            </datalist>
        </div>
    );
}

function BoxSide({node, styleKey, abbr, listId, onChange}: {
    node: PNode;
    styleKey: string;
    abbr: string;
    listId: string;
    onChange: () => void
}) {
    const [val, setVal] = useState<string>(styleVal(node, styleKey) ?? "");
    return (
        <input
            className="dp-in dp-box-in"
            type="text"
            list={listId}
            value={val}
            placeholder={abbr}
            title={abbr}
            onChange={(e) => {
                setVal(e.target.value);
                setStyleVal(node, styleKey, e.target.value);
                onChange();
            }}
        />
    );
}

function ContentTab({node, onChange}: { node: PNode; onChange: () => void }) {
    return (
        <>
            {contentFields(node.type).map((fld) => (
                <ContentField_ key={fld.k} node={node} fld={fld} onChange={onChange}/>
            ))}
            <div className="dp-group">Text</div>
            <StyleField node={node} label="Text colour" styleKey="color" kind="color" onChange={onChange}/>
            <StyleField node={node} label="Font size" styleKey="fontSize" kind="text" placeholder="e.g. 1.25rem"
                        onChange={onChange}/>
            <StyleField node={node} label="Font weight" styleKey="fontWeight" kind="select"
                        options={["400", "500", "600", "700", "800", "900"]} onChange={onChange}/>
            <StyleField node={node} label="Text align" styleKey="textAlign" kind="select"
                        options={["left", "center", "right", "justify"]} onChange={onChange}/>
            <StyleField node={node} label="Line height" styleKey="lineHeight" kind="text" placeholder="e.g. 1.6"
                        onChange={onChange}/>
            <StyleField node={node} label="Font family" styleKey="fontFamily" kind="text"
                        placeholder="token:fontHeading" onChange={onChange}/>
        </>
    );
}

function LayoutTab({node, container, onChange}: { node: PNode; container: boolean; onChange: () => void }) {
    const flexish = node.type === "row" || node.type === "column" || node.type === "grid" || node.type === "form";
    return (
        <>
            <div className="dp-group">Size</div>
            <StyleField node={node} label="Width" styleKey="width" kind="text" placeholder="auto / 100% / 320px"
                        onChange={onChange}/>
            <StyleField node={node} label="Max width" styleKey="maxWidth" kind="text" placeholder="none = full width"
                        onChange={onChange}/>
            <StyleField node={node} label="Height" styleKey="height" kind="text" placeholder="auto / 320px"
                        onChange={onChange}/>
            <StyleField node={node} label="Min height" styleKey="minHeight" kind="text" placeholder="e.g. 320px"
                        onChange={onChange}/>
            <StyleField node={node} label="Max height" styleKey="maxHeight" kind="text" placeholder="none / e.g. 480px"
                        onChange={onChange}/>
            {container && (
                <>
                    <div className="dp-group">Layout</div>
                    {flexish && <StyleField node={node} label="Direction" styleKey="flexDirection" kind="select"
                                            options={["row", "column"]} onChange={onChange}/>}
                    <StyleField node={node} label="Justify" styleKey="justifyContent" kind="select"
                                options={["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"]}
                                onChange={onChange}/>
                    <StyleField node={node} label="Align items" styleKey="alignItems" kind="select"
                                options={["stretch", "flex-start", "center", "flex-end", "baseline"]}
                                onChange={onChange}/>
                    <StyleField node={node} label="Gap" styleKey="gap" kind="text" placeholder="e.g. 1rem"
                                onChange={onChange}/>
                </>
            )}
            <div className="dp-group">Spacing</div>
            <BoxField node={node} label="Padding" prefix="padding" onChange={onChange}/>
            <BoxField node={node} label="Margin" prefix="margin" onChange={onChange}/>
            <div className="dp-group">Background</div>
            <StyleField node={node} label="Background" styleKey="background" kind="color" onChange={onChange}/>
            <div className="dp-group">Border</div>
            <StyleField node={node} label="Border width" styleKey="borderWidth" kind="text" placeholder="e.g. 1px"
                        onChange={onChange}/>
            <StyleField node={node} label="Border style" styleKey="borderStyle" kind="select"
                        options={["solid", "dashed", "dotted", "none"]} onChange={onChange}/>
            <StyleField node={node} label="Border colour" styleKey="borderColor" kind="color" onChange={onChange}/>
            <StyleField node={node} label="Radius" styleKey="borderRadius" kind="text" placeholder="e.g. 12px"
                        onChange={onChange}/>
        </>
    );
}
