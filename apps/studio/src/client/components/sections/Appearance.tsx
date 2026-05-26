import {useEffect, useRef, useState} from "react";
import {api} from "../../api";
import {ErrorCard, Loading, RowHead, useLoader, useToast} from "../ui";

interface TokenDef {
    key: string;
    label: string;
    group: string;
    type: string;
    default: string;
}

interface ThemeDef {
    slug: string;
    name: string;
    tokens?: TokenDef[];
}

interface TypeRow {
    slug: string;
    name: string;
}

interface Initial {
    themes: ThemeDef[];
    theme: string;
    tokens: Record<string, string>;
    siteName: string;
    sources: string[];
    types: TypeRow[];
}

export function Appearance() {
    const {data, loading, error} = useLoader<Initial>(async () => {
        const [t, s, ty] = await Promise.all([
            api<{
                settings?: { theme?: string; tokens?: Record<string, string>; siteName?: string };
                themes?: ThemeDef[]
            }>("/admin/api/theme"),
            api<{ settings?: { connectedSources?: string[] } }>("/admin/api/settings"),
            api<{ items?: TypeRow[] }>("/admin/api/types"),
        ]);
        const settings = t.body.settings || {};
        return {
            themes: t.body.themes || [],
            theme: settings.theme || "default",
            tokens: {...(settings.tokens || {})},
            siteName: settings.siteName || "Pressh",
            sources: s.body.settings?.connectedSources || [],
            types: ty.body.items || [],
        };
    });

    if (loading) return <Loading/>;
    if (error) return <ErrorCard message={error}/>;
    if (!data) return null;
    return <AppearanceForm initial={data}/>;
}

function AppearanceForm({initial}: { initial: Initial }) {
    const toast = useToast();
    const [theme, setTheme] = useState(initial.theme);
    const [tokens, setTokens] = useState<Record<string, string>>(initial.tokens);
    const [siteName, setSiteName] = useState(initial.siteName);
    const [search, setSearch] = useState("");
    const [sources, setSources] = useState<string[]>(initial.sources);
    const [srcdoc, setSrcdoc] = useState("");
    const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const themeDef = initial.themes.find((t) => t.slug === theme) || initial.themes[0] || {
        slug: "",
        name: "",
        tokens: []
    };

    // Debounced live preview whenever the theme/tokens/site name change.
    useEffect(() => {
        if (previewTimer.current) clearTimeout(previewTimer.current);
        previewTimer.current = setTimeout(async () => {
            const r = await api<{ html?: string }>("/admin/api/theme/preview", {
                method: "POST",
                body: JSON.stringify({theme, tokens, siteName}),
            });
            if (r.body.html) setSrcdoc(r.body.html);
        }, 400);
        return () => {
            if (previewTimer.current) clearTimeout(previewTimer.current);
        };
    }, [theme, tokens, siteName]);

    function setToken(key: string, val: string) {
        setTokens((prev) => ({...prev, [key]: val}));
    }

    async function saveTheme() {
        const r = await api("/admin/api/theme", {method: "PUT", body: JSON.stringify({theme, tokens, siteName})});
        if (r.status === 200) toast("Appearance saved");
        else toast("Save failed", true);
    }

    async function saveSources() {
        const r = await api("/admin/api/settings", {method: "PUT", body: JSON.stringify({connectedSources: sources})});
        if (r.status === 200) toast("Data sources saved");
        else toast("Could not save data sources", true);
    }

    // Group + filter tokens for the controls panel.
    const ql = search.toLowerCase().trim();
    const groups: Record<string, TokenDef[]> = {};
    for (const tk of themeDef.tokens || []) (groups[tk.group] ||= []).push(tk);

    return (
        <>
            <RowHead title="Appearance">
                <button className="btn-sm" onClick={saveTheme}>
                    Save changes
                </button>
            </RowHead>

            <div style={{display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.1rem", alignItems: "start"}}>
                <div className="card">
                    <h3>Theme</h3>
                    <label>Active theme</label>
                    <select
                        value={theme}
                        onChange={(e) => {
                            setTheme(e.target.value);
                            setSearch("");
                        }}
                    >
                        {initial.themes.map((t) => (
                            <option key={t.slug} value={t.slug}>
                                {t.name}
                            </option>
                        ))}
                    </select>
                    <label>Site name</label>
                    <input value={siteName} onChange={(e) => setSiteName(e.target.value)}/>
                    <div className="srch-bar" style={{marginTop: "1rem"}}>
                        <input placeholder="Search tokens..." value={search}
                               onChange={(e) => setSearch(e.target.value)}/>
                    </div>
                    <div>
                        {Object.keys(groups).map((g) => {
                            let toks = groups[g]!;
                            if (ql) {
                                toks = toks.filter(
                                    (tk) =>
                                        tk.label.toLowerCase().includes(ql) ||
                                        tk.key.toLowerCase().includes(ql) ||
                                        g.toLowerCase().includes(ql),
                                );
                            }
                            if (!toks.length) return null;
                            return (
                                <div className="tk-group" key={g}>
                                    <h4>{g}</h4>
                                    {toks.map((tk) => {
                                        const val = tokens[tk.key] != null ? tokens[tk.key]! : tk.default;
                                        if (tk.type === "color") {
                                            return (
                                                <div className="color-row" key={tk.key}>
                                                    <label>{tk.label}</label>
                                                    <input type="color" value={val}
                                                           onChange={(e) => setToken(tk.key, e.target.value)}/>
                                                    <input type="text" value={val}
                                                           onChange={(e) => setToken(tk.key, e.target.value)}/>
                                                </div>
                                            );
                                        }
                                        return (
                                            <div key={tk.key}>
                                                <label>{tk.label}</label>
                                                <input type="text" value={val}
                                                       onChange={(e) => setToken(tk.key, e.target.value)}/>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                        {ql && !Object.keys(groups).some((g) => groups[g]!.some((tk) => tk.label.toLowerCase().includes(ql) || tk.key.toLowerCase().includes(ql) || g.toLowerCase().includes(ql))) && (
                            <div className="empty" style={{padding: ".6rem 0"}}>
                                No tokens match your search.
                            </div>
                        )}
                    </div>
                </div>

                <div className="card">
                    <h3>Live preview</h3>
                    <p className="hint">Sandboxed — exactly how the public site renders.</p>
                    <iframe
                        sandbox="allow-same-origin"
                        srcDoc={srcdoc}
                        style={{
                            width: "100%",
                            height: 520,
                            border: "1px solid var(--card-border)",
                            borderRadius: 10,
                            background: "#fff"
                        }}
                    />
                </div>
            </div>

            <div className="card">
                <div className="row-head" style={{margin: "0 0 .75rem"}}>
                    <div>
                        <h3 style={{margin: 0}}>Data Sources</h3>
                        <p className="hint" style={{margin: ".2rem 0 0"}}>
                            Select which content types are connected as data sources for dynamic collection lists on
                            your site.
                        </p>
                    </div>
                    <button className="btn-sm" onClick={saveSources}>
                        Save sources
                    </button>
                </div>
                {initial.types.length ? (
                    initial.types.map((t) => {
                        const on = sources.includes(t.slug);
                        return (
                            <div className="src-item" key={t.slug}>
                                <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={(e) =>
                                        setSources((prev) => (e.target.checked ? [...new Set([...prev, t.slug])] : prev.filter((s) => s !== t.slug)))
                                    }
                                />
                                <div>
                                    <div className="src-name">{t.name}</div>
                                    <div className="src-slug">/{t.slug}</div>
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="empty" style={{fontSize: ".82rem"}}>
                        No content types yet — create one under Content Types first.
                    </div>
                )}
            </div>
        </>
    );
}
