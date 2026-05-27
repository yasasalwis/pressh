import {type ReactNode, useState} from "react";
import type {Me} from "../types";
import {toggleTheme} from "../theme";

interface NavItem {
    section: string;
    label: string;
    icon: string;
    cap?: string;
}

interface NavGroup {
    label: string;
    cap?: string;
    items: NavItem[];
}

const GROUPS: NavGroup[] = [
    {
        label: "Content",
        items: [
            {section: "dashboard", label: "Dashboard", icon: "📊"},
            {section: "pages", label: "Pages", icon: "📄"},
            {section: "types", label: "Content Types", icon: "🧱", cap: "types.manage"},
            {section: "media", label: "Media", icon: "📷", cap: "media.read"},
        ],
    },
    {
        label: "People",
        items: [
            {section: "users", label: "Users", icon: "👥", cap: "users.manage"},
            {section: "members", label: "Members", icon: "🧑‍🤝‍🧑", cap: "members.manage"},
        ],
    },
    {
        label: "Site",
        cap: "themes.manage",
        items: [
            {section: "appearance", label: "Appearance", icon: "🎨", cap: "themes.manage"},
            {section: "settings", label: "Settings", icon: "⚙", cap: "settings.manage"},
        ],
    },
    {
        label: "System",
        cap: "audit.read",
        items: [
            {section: "plugins", label: "Plugins", icon: "🧩", cap: "plugins.manage"},
            {section: "database", label: "Database", icon: "💾", cap: "db.manage"},
            {section: "backups", label: "Backups", icon: "🗄", cap: "backups.manage"},
            {section: "privacy", label: "Privacy & GDPR", icon: "🔒", cap: "gdpr.manage"},
            {section: "audit", label: "Audit Log", icon: "📜", cap: "audit.read"},
        ],
    },
];

export function Shell({
                          me,
                          can,
                          active,
                          title,
                          onLogout,
                          onOpenPassword,
                          onOpenSecurity,
                          children,
                      }: {
    me: Me;
    can: (cap: string) => boolean;
    active: string;
    title: string;
    onLogout: () => void;
    onOpenPassword: () => void;
    onOpenSecurity: () => void;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const siteUrl = location.protocol + "//" + location.hostname + ":3000";

    return (
        <section>
            <div className="shell">
                <aside className={"sidebar" + (open ? " open" : "")}>
                    <div className="sb-brand">
                        <div className="logo">P</div>
                        <div>
                            <h1>Pressh Studio</h1>
                            <p>Admin</p>
                        </div>
                    </div>
                    <nav className="sb-nav">
                        {GROUPS.map((g) => {
                            if (g.cap && !can(g.cap)) return null;
                            const items = g.items.filter((it) => !it.cap || can(it.cap));
                            if (!items.length) return null;
                            return (
                                <div key={g.label}>
                                    <div className="nav-group-label">{g.label}</div>
                                    {items.map((it) => (
                                        <a
                                            key={it.section}
                                            className={"nav-item" + (active === it.section ? " active" : "")}
                                            href={"#/" + it.section}
                                            onClick={() => setOpen(false)}
                                        >
                                            <span className="ico">{it.icon}</span>
                                            {it.label}
                                        </a>
                                    ))}
                                </div>
                            );
                        })}
                    </nav>
                    <div className="sb-foot">
                        <div className="sb-user">{me.user.email}</div>
                        <div className="row">
                            <a className="ghost" href={siteUrl} target="_blank" rel="noopener">
                                View site ↗
                            </a>
                            <button className="ghost" onClick={toggleTheme} title="Toggle theme">
                                &#9681;
                            </button>
                        </div>
                        <div className="row">
                            <button className="ghost" onClick={onOpenPassword}>
                                Password
                            </button>
                            <button className="ghost" onClick={onOpenSecurity}>
                                {me.user.mfaEnabled ? "2FA ✓" : "2FA"}
                            </button>
                        </div>
                        <div className="row">
                            <button className="ghost danger" onClick={onLogout}>
                                Sign out
                            </button>
                        </div>
                    </div>
                </aside>
                <div className="main">
                    <div className="topbar">
                        <button className="menu-btn" onClick={() => setOpen((o) => !o)}>
                            &#9776;
                        </button>
                        <h2>{title}</h2>
                        <div className="spacer"/>
                    </div>
                    <div className="view">{children}</div>
                </div>
            </div>
        </section>
    );
}
