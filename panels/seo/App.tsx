import {useCallback, useEffect, useState} from "react";
import {request} from "../shared/bridge";

interface Meta {
    description: string;
    ogTitle: string;
    ogDescription: string;
    ogImage: string;
    robots: string;
}

interface Override extends Meta {
    slug: string;
}

interface GetAllResp {
    defaults: Partial<Meta>;
    overrides: Override[];
}

const EMPTY: Meta = {description: "", ogTitle: "", ogDescription: "", ogImage: "", robots: ""};

function toMeta(m: Partial<Meta> | undefined): Meta {
    return {
        description: m?.description || "",
        ogTitle: m?.ogTitle || "",
        ogDescription: m?.ogDescription || "",
        ogImage: m?.ogImage || "",
        robots: m?.robots || "",
    };
}

function MetaFields({
                        value,
                        onChange,
                        imageLabel,
                    }: {
    value: Meta;
    onChange: (m: Meta) => void;
    imageLabel: string;
}) {
    const set = (k: keyof Meta) => (e: { target: { value: string } }) => onChange({...value, [k]: e.target.value});
    return (
        <>
            <label>Meta description</label>
            <textarea rows={2} value={value.description} onChange={set("description")}/>
            <label>OpenGraph title</label>
            <input value={value.ogTitle} onChange={set("ogTitle")}/>
            <label>OpenGraph description</label>
            <textarea rows={2} value={value.ogDescription} onChange={set("ogDescription")}/>
            <label>{imageLabel}</label>
            <input value={value.ogImage} onChange={set("ogImage")}/>
            <label>Robots (e.g. index,follow)</label>
            <input value={value.robots} onChange={set("robots")}/>
        </>
    );
}

export function App() {
    const [defaults, setDefaults] = useState<Meta>(EMPTY);
    const [overrides, setOverrides] = useState<Override[]>([]);
    const [loadErr, setLoadErr] = useState<string | null>(null);

    const [slug, setSlug] = useState("");
    const [override, setOverride] = useState<Meta>(EMPTY);

    const [dmsg, setDmsg] = useState<{ text: string; err?: boolean } | null>(null);
    const [omsg, setOmsg] = useState<{ text: string; err?: boolean } | null>(null);

    const load = useCallback(async () => {
        try {
            const r = await request<GetAllResp>("getAll");
            setDefaults(toMeta(r.defaults));
            setOverrides(r.overrides || []);
            setLoadErr(null);
        } catch (e) {
            setLoadErr(e instanceof Error ? e.message : String(e));
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function saveDefaults() {
        try {
            await request("saveDefaults", {meta: defaults});
            setDmsg({text: "Saved."});
        } catch (e) {
            setDmsg({text: e instanceof Error ? e.message : String(e), err: true});
        }
    }

    async function saveOverride() {
        const s = slug.trim();
        if (!s) {
            setOmsg({text: "Enter a slug.", err: true});
            return;
        }
        try {
            await request("saveOverride", {slug: s, meta: override});
            setOmsg({text: "Saved."});
            await load();
        } catch (e) {
            setOmsg({text: e instanceof Error ? e.message : String(e), err: true});
        }
    }

    function clearOverride() {
        setSlug("");
        setOverride(EMPTY);
        setOmsg(null);
    }

    function editOverride(o: Override) {
        setSlug(o.slug);
        setOverride(toMeta(o));
        window.scrollTo(0, document.body.scrollHeight);
    }

    async function delOverride(s: string) {
        if (!confirm("Remove override for " + s + "?")) return;
        try {
            await request("removeOverride", {slug: s});
            await load();
        } catch (e) {
            alert(e instanceof Error ? e.message : String(e));
        }
    }

    return (
        <>
            <h2>SEO</h2>
            <p className="muted">Defaults apply site-wide; per-page entries override them by slug.</p>

            <div className="card">
                <h3>Site defaults</h3>
                <MetaFields
                    value={defaults}
                    onChange={setDefaults}
                    imageLabel="OpenGraph image URL (http(s) or /relative only)"
                />
                <div className="row" style={{marginTop: 10}}>
                    <button className="primary" onClick={saveDefaults}>
                        Save defaults
                    </button>
                    {dmsg && <span className={dmsg.err ? "err" : "muted"}>{dmsg.text}</span>}
                </div>
            </div>

            <div className="card">
                <h3>Per-page override</h3>
                <label>Page slug (e.g. about)</label>
                <input value={slug} onChange={(e) => setSlug(e.target.value)}/>
                <MetaFields value={override} onChange={setOverride} imageLabel="OpenGraph image URL"/>
                <div className="row" style={{marginTop: 10}}>
                    <button className="primary" onClick={saveOverride}>
                        Save override
                    </button>
                    <button onClick={clearOverride}>Clear</button>
                    {omsg && <span className={omsg.err ? "err" : "muted"}>{omsg.text}</span>}
                </div>
            </div>

            <div className="card">
                <h3>Page overrides</h3>
                {loadErr ? (
                    <p className="err">Could not load SEO settings: {loadErr}</p>
                ) : overrides.length ? (
                    <table>
                        <thead>
                        <tr>
                            <th>Slug</th>
                            <th>Description</th>
                            <th></th>
                        </tr>
                        </thead>
                        <tbody>
                        {overrides.map((o) => (
                            <tr key={o.slug}>
                                <td>
                                    <b>{o.slug}</b>
                                </td>
                                <td>{o.description}</td>
                                <td className="row">
                                    <button onClick={() => editOverride(o)}>Edit</button>
                                    <button className="danger" onClick={() => delOverride(o.slug)}>
                                        Remove
                                    </button>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                ) : (
                    <p className="muted">No per-page overrides yet.</p>
                )}
            </div>
        </>
    );
}
