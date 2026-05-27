import {useEffect, useState} from "react";
import {api} from "../api";

interface Stat {
    n: number;
    label: string;
    href: string;
}

function StatCard({stat}: { stat: Stat }) {
    const inner = (
        <>
            <div className="n">{stat.n}</div>
            <div className="l">{stat.label}</div>
        </>
    );
    if (stat.href) {
        return (
            <a className="stat clickable" href={stat.href}>
                {inner}
            </a>
        );
    }
    return <div className="stat">{inner}</div>;
}

export function Dashboard({can}: { can: (cap: string) => boolean }) {
    const [stats, setStats] = useState<Stat[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const content = await api<{ items?: { status?: string }[] }>("/admin/api/content");
                const pages = content.body.items || [];
                const pub = pages.filter((p) => p.status === "published").length;
                const cards: Stat[] = [
                    {n: pages.length, label: "Pages", href: "#/pages"},
                    {n: pub, label: "Published", href: ""},
                    {n: pages.length - pub, label: "Drafts", href: ""},
                ];
                if (can("media.read")) {
                    const m = await api<{ items?: unknown[] }>("/admin/api/media");
                    cards.push({n: (m.body.items || []).length, label: "Media files", href: "#/media"});
                }
                if (can("users.manage")) {
                    const u = await api<{ users?: unknown[]; invites?: unknown[] }>("/admin/api/users");
                    cards.push({n: (u.body.users || []).length, label: "Users", href: "#/users"});
                    cards.push({n: (u.body.invites || []).length, label: "Pending invites", href: "#/users"});
                }
                if (can("plugins.manage")) {
                    const pl = await api<{ items?: unknown[] }>("/admin/api/plugins");
                    cards.push({n: (pl.body.items || []).length, label: "Plugins", href: "#/plugins"});
                }
                if (alive) setStats(cards);
            } catch (e) {
                if (alive) setError(e instanceof Error ? e.message : String(e));
            }
        })();
        return () => {
            alive = false;
        };
    }, [can]);

    const showCreate = can("types.manage") && can("content.create");

    return (
        <div className="card">
            <div className="row-head">
                <div>
                    <h3>Welcome to Pressh Studio</h3>
                    <p className="hint" style={{margin: 0}}>
                        Manage content, people, and configuration from one place.
                    </p>
                </div>
                {showCreate && (
                    <a className="btn-sm" href="#/pages">
                        Manage pages
                    </a>
                )}
            </div>
            {error ? (
                <p className="alert">{error}</p>
            ) : !stats ? (
                <div className="loading">Loading…</div>
            ) : (
                <div className="dashboard-grid">
                    {stats.map((s, i) => (
                        <StatCard key={i} stat={s}/>
                    ))}
                </div>
            )}
        </div>
    );
}
