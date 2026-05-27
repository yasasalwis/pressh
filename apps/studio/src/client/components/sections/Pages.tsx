import {useState} from "react";
import {api} from "../../api";
import {ErrorCard, Loading, Modal, RowHead, fmtDate, useLoader, useToast} from "../ui";

interface Entry {
    id: string;
    slug: string;
    typeId?: string;
    status: string;
    currentRevision?: number;
    system?: boolean;
    locale?: string;
}

interface ContentType {
    id: string;
    name: string;
}

const LAYOUT_FRAGMENTS = ["header", "footer"];
const SYSTEM_PAGES = ["home", "404", "500", "maintenance"];
const SYSTEM_SLUGS = new Set([...LAYOUT_FRAGMENTS, ...SYSTEM_PAGES]);
const SYSTEM_LABELS: Record<string, string> = {
    header: "Header Layout",
    footer: "Footer Layout",
    home: "Homepage",
    "404": "404 — Not Found",
    "500": "500 — Server Error",
    maintenance: "Maintenance Page",
};

const isSystem = (p: Entry) => !!p.system || SYSTEM_SLUGS.has(p.slug);
const isFragment = (p: Entry) => LAYOUT_FRAGMENTS.includes(p.slug);

function go(hash: string) {
    location.hash = hash;
}

export function Pages({can}: { can: (cap: string) => boolean }) {
    const toast = useToast();
    const canNav = can("settings.manage");
    const canCreate = can("types.manage") && can("content.create");

    const {data, loading, error, reload} = useLoader(async () => {
        const c = await api<{ items?: Entry[] }>("/admin/api/content");
        const t = await api<{ items?: ContentType[] }>("/admin/api/types");
        const s = canNav ? await api<{ settings?: { headerNav?: string[] } }>("/admin/api/settings") : null;
        const l = await api<{ locales?: string[] }>("/admin/api/locales");
        return {
            items: c.body.items || [],
            types: t.body.items || [],
            headerNav: s?.body.settings?.headerNav || [],
            locales: l.body.locales || ["en"],
        };
    });

    const [showNew, setShowNew] = useState(false);
    const [filter, setFilter] = useState("");
    const [revisionsFor, setRevisionsFor] = useState<{ id: string; slug: string } | null>(null);
    // optimistic header-nav set
    const [navOverride, setNavOverride] = useState<string[] | null>(null);
    const headerNav = navOverride ?? data?.headerNav ?? [];

    async function transition(id: string, to: string) {
        const path = to === "published" ? "/admin/api/content/" + id + "/publish" : "/admin/api/content/" + id + "/transition";
        await api(path, {method: "POST", body: JSON.stringify({to})});
        reload();
    }

    async function toggleNav(id: string, on: boolean) {
        const next = on ? [...new Set([...headerNav, id])] : headerNav.filter((x) => x !== id);
        setNavOverride(next);
        const r = await api("/admin/api/settings", {method: "PUT", body: JSON.stringify({headerNav: next})});
        if (r.status === 200) toast(on ? "Added to header navigation" : "Removed from header navigation");
        else {
            toast("Could not update navigation", true);
            setNavOverride(headerNav);
        }
    }

    if (loading) return <Loading/>;
    if (error) return <ErrorCard message={error}/>;
    if (!data) return null;

    const typeName = (id: string | undefined) => data.types.find((t) => t.id === id)?.name;
    const fragments = data.items.filter((p) => isSystem(p) && isFragment(p));
    const systemPages = data.items.filter((p) => isSystem(p) && !isFragment(p));
    const allPages = data.items.filter((p) => !isSystem(p));
    const q = filter.trim().toLowerCase();
    const pages = q
        ? allPages.filter((p) => p.slug.toLowerCase().includes(q) || (typeName(p.typeId) ?? "").toLowerCase().includes(q))
        : allPages;

    return (
        <>
            <RowHead title="Pages">
                {allPages.length > 0 && (
                    <input
                        type="search"
                        placeholder="Filter pages…"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        style={{maxWidth: "14rem"}}
                    />
                )}
                {canCreate && (
                    <button className="btn-sm" onClick={() => setShowNew((s) => !s)}>
                        + New page
                    </button>
                )}
            </RowHead>

            {canCreate && showNew && <NewPageForm locales={data.locales} onCancel={() => setShowNew(false)}/>}

            <LockedCard title="Layout fragments" sub="Injected into every page · always published" rows={fragments}/>
            <LockedCard title="System pages" sub="Built-in pages · non-deletable" rows={systemPages}/>

            <div className="card">
                {!pages.length ? (
                    <div className="empty">
                        <span className="ico">📄</span>
                        {q ? "No pages match your filter." : "No pages yet. Create your first one."}
                    </div>
                ) : (
                    pages.map((p) => {
                        const inNav = headerNav.includes(p.id);
                        return (
                            <div className="list-row" key={p.id}>
                                <div className="grow">
                                    <div className="title">{typeName(p.typeId) || p.slug}</div>
                                    <div className="meta">
                                        /{p.slug} · rev {p.currentRevision || 1}
                                    </div>
                                </div>
                                {data.locales.length > 1 && p.locale ? (
                                    <span className="tag" title="Locale">{p.locale}</span>
                                ) : null}
                                <span className={"badge b-" + p.status}>{p.status}</span>
                                {canNav && (
                                    <>
                                        <label className="sw" title="Show in header navigation">
                                            <input type="checkbox" checked={inNav}
                                                   onChange={(e) => toggleNav(p.id, e.target.checked)}/>
                                            <span className="sw-track"/>
                                        </label>
                                        <span className="nav-lbl">Header</span>
                                    </>
                                )}
                                <button className="iconbtn" title="Revision history"
                                        onClick={() => setRevisionsFor({id: p.id, slug: p.slug})}>
                                    ↻
                                </button>
                                {p.status === "published" && (
                                    <a
                                        className="ghost"
                                        href={location.protocol + "//" + location.hostname + ":3000/" + p.slug}
                                        target="_blank"
                                        rel="noopener"
                                    >
                                        View
                                    </a>
                                )}
                                <button className="btn-sm" onClick={() => go("#/page/" + p.id)}>
                                    ✎ Edit
                                </button>
                                {p.status === "published" ? (
                                    <button className="ghost" onClick={() => transition(p.id, "draft")}>
                                        Unpublish
                                    </button>
                                ) : (
                                    <button className="btn-sm btn-ok" onClick={() => transition(p.id, "published")}>
                                        Publish
                                    </button>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {revisionsFor &&
                <RevisionsModal {...revisionsFor} onClose={() => setRevisionsFor(null)} onRestored={reload}/>}
        </>
    );
}

function LockedCard({title, sub, rows}: { title: string; sub: string; rows: Entry[] }) {
    if (!rows.length) return null;
    return (
        <div className="card" style={{marginBottom: ".8rem"}}>
            <div className="row-head" style={{marginBottom: ".6rem"}}>
                <h3 style={{margin: 0, fontSize: ".9rem"}}>{title}</h3>
                <span className="meta" style={{fontSize: ".78rem"}}>
          {sub}
        </span>
            </div>
            {rows.map((p) => (
                <div className="list-row" key={p.id}>
          <span className="ico" style={{fontSize: "1rem", marginRight: ".4rem"}}>
            🔒
          </span>
                    <div className="grow">
                        <div className="title">{SYSTEM_LABELS[p.slug] || p.slug}</div>
                        <div className="meta">
                            /{p.slug} · rev {p.currentRevision || 1}
                        </div>
                    </div>
                    <span className="badge b-published">published</span>
                    <button className="btn-sm" onClick={() => go("#/page/" + p.id)}>
                        ✎ Edit
                    </button>
                </div>
            ))}
        </div>
    );
}

function NewPageForm({locales, onCancel}: { locales: string[]; onCancel: () => void }) {
    const [title, setTitle] = useState("");
    const [slug, setSlug] = useState("");
    const [slugTouched, setSlugTouched] = useState(false);
    const [locale, setLocale] = useState(locales[0] ?? "en");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    async function create(publish: boolean) {
        setError("");
        if (!title.trim()) return setError("A title is required.");
        if (!slug.trim()) return setError("A slug is required.");
        setBusy(true);
        const tr = await api<{ data?: { id: string }; error?: { message?: string } }>("/admin/api/types", {
            method: "POST",
            body: JSON.stringify({
                name: title.trim(),
                slug: slug.trim(),
                fields: [{id: "f0", name: "title", type: "text", required: true}]
            }),
        });
        if (tr.status !== 200) {
            setBusy(false);
            return setError(tr.body.error?.message || "Could not create.");
        }
        const er = await api<{ data?: { id: string }; error?: { message?: string } }>("/admin/api/content", {
            method: "POST",
            body: JSON.stringify({
                typeId: tr.body.data?.id,
                slug: slug.trim(),
                fields: {title: title.trim()},
                blocks: [],
                locale,
            }),
        });
        if (er.status !== 200) {
            setBusy(false);
            return setError(er.body.error?.message || "Could not create.");
        }
        const entryId = er.body.data?.id;
        if (publish && entryId) await api("/admin/api/content/" + entryId + "/publish", {method: "POST", body: "{}"});
        if (entryId) go("#/page/" + entryId);
    }

    return (
        <div className="card">
            <h3>New page</h3>
            <label>Title</label>
            <input
                placeholder="e.g. About Us"
                value={title}
                onChange={(e) => {
                    setTitle(e.target.value);
                    if (!slugTouched) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                }}
            />
            <label>
                Slug <span className="meta">(letters, numbers, hyphens)</span>
            </label>
            <input
                placeholder="about-us"
                value={slug}
                onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugTouched(true);
                }}
            />
            {locales.length > 1 && (
                <>
                    <label>Language</label>
                    <select value={locale} onChange={(e) => setLocale(e.target.value)}>
                        {locales.map((l) => (
                            <option key={l} value={l}>{l}</option>
                        ))}
                    </select>
                </>
            )}
            {error && <div className="alert">{error}</div>}
            <div style={{display: "flex", gap: ".5rem", marginTop: ".8rem"}}>
                <button className="btn-sm" onClick={() => create(false)} disabled={busy}>
                    Create draft
                </button>
                <button className="btn-sm btn-ok" onClick={() => create(true)} disabled={busy}>
                    Create &amp; publish
                </button>
                <button className="ghost" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

interface Revision {
    version: number;
    createdAt: string;
}

function RevisionsModal({id, slug, onClose, onRestored}: {
    id: string;
    slug: string;
    onClose: () => void;
    onRestored: () => void
}) {
    const toast = useToast();
    const {data, loading} = useLoader(
        async () => (await api<{ items?: Revision[] }>("/admin/api/content/" + id + "/revisions")).body.items || [],
        [id],
    );

    async function restore(version: number) {
        const r = await api("/admin/api/content/" + id + "/revisions/" + version + "/restore", {method: "POST"});
        if (r.status === 200) {
            toast("Revision " + version + " restored");
            onClose();
            onRestored();
        } else toast("Restore failed", true);
    }

    const items = (data || []).slice().reverse();
    return (
        <Modal onClose={onClose}>
            <h3>Revision history</h3>
            <p className="hint">/{slug} — restoring creates a new revision from the chosen one.</p>
            <div style={{maxHeight: 340, overflow: "auto"}}>
                {loading ? (
                    <Loading/>
                ) : !items.length ? (
                    <div className="empty">No revisions.</div>
                ) : (
                    items.map((rev) => (
                        <div className="list-row" key={rev.version}>
                            <div className="grow">
                                <div className="title">Revision {rev.version}</div>
                                <div className="meta">{fmtDate(rev.createdAt)}</div>
                            </div>
                            <button className="btn-sm" onClick={() => restore(rev.version)}>
                                Restore
                            </button>
                        </div>
                    ))
                )}
            </div>
            <div className="actions">
                <button className="ghost" onClick={onClose}>
                    Close
                </button>
            </div>
        </Modal>
    );
}
