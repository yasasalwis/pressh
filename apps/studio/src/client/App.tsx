import {type ReactNode, useCallback, useEffect, useState} from "react";
import {api, setCsrf} from "./api";
import {makeCan} from "./caps";
import type {Me} from "./types";
import {AcceptInvite, Login, Setup} from "./components/AuthScreens";
import {Shell} from "./components/Shell";
import {Dashboard} from "./components/Dashboard";
import {Placeholder} from "./components/Placeholder";
import {PasswordModal} from "./components/PasswordModal";

type Phase = "loading" | "setup" | "login" | "accept" | "app";

interface Route {
    view: "section" | "accept" | "designer";
    section: string;
    token: string;
    id: string;
}

function parseHash(): Route {
    const h = location.hash || "";
    let m = h.match(/^#\/invite\/(.+)$/);
    if (m) return {view: "accept", section: "", token: decodeURIComponent(m[1] ?? ""), id: ""};
    m = h.match(/^#\/page\/(.+)$/);
    if (m) return {view: "designer", section: "", token: "", id: decodeURIComponent(m[1] ?? "")};
    m = h.match(/^#\/([a-z]+)$/);
    if (m) return {view: "section", section: m[1] ?? "dashboard", token: "", id: ""};
    return {view: "section", section: "dashboard", token: "", id: ""};
}

const SECTION_TITLE: Record<string, string> = {
    dashboard: "Dashboard",
    pages: "Pages",
    types: "Content Types",
    media: "Media",
    users: "Users",
    appearance: "Appearance",
    settings: "Settings",
    plugins: "Plugins",
    privacy: "Privacy & GDPR",
    audit: "Audit Log",
    database: "Database",
};

const SECTION_CAP: Record<string, string> = {
    types: "types.manage",
    media: "media.read",
    users: "users.manage",
    appearance: "themes.manage",
    settings: "settings.manage",
    plugins: "plugins.manage",
    privacy: "gdpr.manage",
    audit: "audit.read",
    database: "db.manage",
};

export function App() {
    const [phase, setPhase] = useState<Phase>("loading");
    const [me, setMe] = useState<Me | null>(null);
    const [route, setRoute] = useState<Route>(parseHash());
    const [acceptToken, setAcceptToken] = useState("");
    const [pwModal, setPwModal] = useState<"closed" | "open" | "forced">("closed");
    const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

    const boot = useCallback(async () => {
        const meRes = await api<Me>("/admin/api/me");
        if (meRes.status === 200) {
            setMe(meRes.body);
            setCsrf(meRes.body.csrfToken);
            setPhase("app");
            if (meRes.body.user.mustChangePassword) setPwModal("forced");
            setRoute(parseHash());
            return;
        }
        const r = parseHash();
        if (r.view === "accept") {
            setAcceptToken(r.token);
            setPhase("accept");
            return;
        }
        const st = await api<{ needsSetup: boolean }>("/admin/api/setup/status");
        setPhase(st.body.needsSetup ? "setup" : "login");
    }, []);

    useEffect(() => {
        void boot();
    }, [boot]);

    useEffect(() => {
        const onHash = () => {
            const r = parseHash();
            setRoute(r);
            if (r.view === "accept" && phase !== "app") {
                setAcceptToken(r.token);
                setPhase("accept");
            }
        };
        window.addEventListener("hashchange", onHash);
        return () => window.removeEventListener("hashchange", onHash);
    }, [phase]);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 2600);
        return () => clearTimeout(t);
    }, [toast]);

    async function logout() {
        await api("/admin/api/auth/logout", {method: "POST"});
        location.hash = "";
        location.reload();
    }

    if (phase === "loading") return <div className="loading" style={{padding: "2rem"}}>Loading…</div>;
    if (phase === "setup") return <Setup onAuthed={boot}/>;
    if (phase === "login") return <Login onAuthed={boot}/>;
    if (phase === "accept") return <AcceptInvite token={acceptToken} onAuthed={boot}/>;
    if (!me) return null;

    const can = makeCan(me.capabilities);
    const isDesigner = route.view === "designer";
    const section = route.view === "section" ? route.section || "dashboard" : "dashboard";
    const title = isDesigner ? "Page Designer" : SECTION_TITLE[section] || "Dashboard";

    let content: ReactNode;
    if (isDesigner) {
        content = <Placeholder title="Page Designer"/>;
    } else {
        const cap = SECTION_CAP[section];
        if (cap && !can(cap)) {
            content = (
                <div className="card">
                    <div className="empty">
                        <span className="ico">🔒</span>
                        You do not have permission to view this section.
                    </div>
                </div>
            );
        } else if (section === "dashboard") {
            content = <Dashboard can={can}/>;
        } else {
            content = <Placeholder title={SECTION_TITLE[section] || section}/>;
        }
    }

    return (
        <>
            <Shell
                me={me}
                can={can}
                active={route.view === "section" ? section : ""}
                title={title}
                onLogout={logout}
                onOpenPassword={() => setPwModal("open")}
            >
                {content}
            </Shell>
            {pwModal !== "closed" && (
                <PasswordModal
                    forced={pwModal === "forced"}
                    onClose={() => setPwModal("closed")}
                    onChanged={() => {
                        setMe((prev) => (prev ? {...prev, user: {...prev.user, mustChangePassword: false}} : prev));
                        setPwModal("closed");
                        setToast({msg: "Password updated"});
                    }}
                />
            )}
            {toast && <div id="toast" className={"show" + (toast.err ? " err" : "")}>{toast.msg}</div>}
        </>
    );
}
