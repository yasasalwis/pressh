import {useCallback, useEffect, useState, type ReactNode} from "react";
import {api, setCsrf} from "./api";
import {makeCan} from "./caps";
import type {Me} from "./types";
import {useToast} from "./components/ui";
import {AcceptInvite, Login, Setup} from "./components/AuthScreens";
import {Shell} from "./components/Shell";
import {Dashboard} from "./components/Dashboard";
import {Placeholder} from "./components/Placeholder";
import {PasswordModal} from "./components/PasswordModal";
import {MfaModal} from "./components/MfaModal";
import {Pages} from "./components/sections/Pages";
import {Types} from "./components/sections/Types";
import {Media} from "./components/sections/Media";
import {Users} from "./components/sections/Users";
import {Members} from "./components/sections/Members";
import {Appearance} from "./components/sections/Appearance";
import {Settings} from "./components/sections/Settings";
import {Plugins} from "./components/sections/Plugins";
import {Database} from "./components/sections/Database";
import {Backups} from "./components/sections/Backups";
import {Privacy} from "./components/sections/Privacy";
import {Audit} from "./components/sections/Audit";
import {Designer} from "./components/designer/Designer";

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
    members: "Members",
  appearance: "Appearance",
  settings: "Settings",
  plugins: "Plugins",
  privacy: "Privacy & GDPR",
  audit: "Audit Log",
  database: "Database",
    backups: "Backups",
};

const SECTION_CAP: Record<string, string> = {
  types: "types.manage",
  media: "media.read",
  users: "users.manage",
    members: "members.manage",
  appearance: "themes.manage",
  settings: "settings.manage",
  plugins: "plugins.manage",
  privacy: "gdpr.manage",
  audit: "audit.read",
  database: "db.manage",
    backups: "backups.manage",
};

function renderSection(section: string, can: (cap: string) => boolean): ReactNode {
  switch (section) {
    case "dashboard":
      return <Dashboard can={can}/>;
    case "pages":
      return <Pages can={can}/>;
    case "types":
      return <Types/>;
    case "media":
      return <Media can={can}/>;
    case "users":
      return <Users/>;
      case "members":
          return <Members/>;
    case "appearance":
      return <Appearance/>;
    case "settings":
      return <Settings/>;
    case "plugins":
      return <Plugins/>;
    case "database":
      return <Database/>;
      case "backups":
          return <Backups/>;
    case "privacy":
      return <Privacy/>;
    case "audit":
      return <Audit/>;
    default:
      return <Placeholder title={SECTION_TITLE[section] || section}/>;
  }
}

export function App() {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [route, setRoute] = useState<Route>(parseHash());
  const [acceptToken, setAcceptToken] = useState("");
  const [pwModal, setPwModal] = useState<"closed" | "open" | "forced">("closed");
    const [mfaModal, setMfaModal] = useState(false);

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

  // The designer is a full-screen overlay (its own route), not a shell section.
  if (route.view === "designer") {
    return <Designer pageId={route.id} onClose={() => {
      location.hash = "#/pages";
    }}/>;
  }

  const section = route.section || "dashboard";
  const title = SECTION_TITLE[section] || "Dashboard";

  let content: ReactNode;
  {
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
    } else {
      content = renderSection(section, can);
    }
  }

  return (
      <>
        <Shell
            me={me}
            can={can}
            active={section}
            title={title}
            onLogout={logout}
            onOpenPassword={() => setPwModal("open")}
            onOpenSecurity={() => setMfaModal(true)}
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
                  toast("Password updated");
                }}
            />
        )}
          {mfaModal && (
              <MfaModal
                  enabled={me.user.mfaEnabled ?? false}
                  onClose={() => setMfaModal(false)}
                  onChanged={(nowEnabled) => {
                      setMe((prev) => (prev ? {...prev, user: {...prev.user, mfaEnabled: nowEnabled}} : prev));
                      setMfaModal(false);
                      toast(nowEnabled ? "Two-factor enabled" : "Two-factor disabled");
                  }}
              />
          )}
      </>
  );
}
