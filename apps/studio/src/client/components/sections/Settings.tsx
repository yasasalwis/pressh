import {useState} from "react";
import {api} from "../../api";
import {ErrorCard, Loading, RowHead, useLoader, useToast} from "../ui";

interface Smtp {
    host?: string;
    port?: number;
    fromEmail?: string;
    username?: string;
    secure?: boolean;
    hasPassword?: boolean;
}

interface Consent {
    enabled?: boolean;
    message?: string;
    policyUrl?: string;
}

interface SettingsData {
    baseUrl?: string;
    defaultLocale?: string;
    timezone?: string;
    maintenanceMode?: boolean;
    smtp?: Smtp;
    smtpAvailable?: boolean;
    consent?: Consent;
    locales?: string[];
}

export function Settings() {
    const {data, loading, error} = useLoader<SettingsData>(
        async () => (await api<{ settings?: SettingsData }>("/admin/api/settings")).body.settings || {},
    );
    if (loading) return <Loading/>;
    if (error) return <ErrorCard message={error}/>;
    if (!data) return null;
    return <SettingsForm initial={data}/>;
}

function SettingsForm({initial}: { initial: SettingsData }) {
    const toast = useToast();
    const smtp = initial.smtp || {};
    const [baseUrl, setBaseUrl] = useState(initial.baseUrl || "");
    const [locale, setLocale] = useState(initial.defaultLocale || "en");
    const [tz, setTz] = useState(initial.timezone || "UTC");
    const [maint, setMaint] = useState(!!initial.maintenanceMode);
    const [host, setHost] = useState(smtp.host || "");
    const [port, setPort] = useState(String(smtp.port || 587));
    const [from, setFrom] = useState(smtp.fromEmail || "");
    const [user, setUser] = useState(smtp.username || "");
    const [pass, setPass] = useState("");
    const [secure, setSecure] = useState(!!smtp.secure);
    const consent = initial.consent || {};
    const [consentOn, setConsentOn] = useState(!!consent.enabled);
    const [consentMsg, setConsentMsg] = useState(consent.message || "");
    const [consentPolicy, setConsentPolicy] = useState(consent.policyUrl || "");
    // Enabled locales (the default is always implicitly included by the server).
    const [locales, setLocales] = useState<string[]>(initial.locales ?? [initial.defaultLocale || "en"]);
    const [newLocale, setNewLocale] = useState("");
    const [error, setError] = useState("");

    function addLocale() {
        const v = newLocale.trim();
        if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(v)) return setError("Locale must look like 'en' or 'en-US'.");
        if (!locales.includes(v)) setLocales([...locales, v]);
        setNewLocale("");
        setError("");
    }

    async function save() {
        setError("");
        const body: Record<string, unknown> = {
            baseUrl: baseUrl.trim(),
            defaultLocale: locale.trim(),
            timezone: tz.trim(),
            maintenanceMode: maint,
            locales,
            consent: {
                enabled: consentOn,
                message: consentMsg.trim(),
                policyUrl: consentPolicy.trim(),
            },
        };
        if (host.trim()) {
            body["smtp"] = {
                host: host.trim(),
                port: Number(port) || 587,
                secure,
                fromEmail: from.trim(),
                username: user.trim(),
            };
            if (pass) body["smtpPassword"] = pass;
        }
        const r = await api("/admin/api/settings", {method: "PUT", body: JSON.stringify(body)});
        if (r.status === 200) toast("Settings saved");
        else setError("Could not save — check the base URL, locale (e.g. en or en-US), timezone, and SMTP fields.");
    }

    async function clearSmtp() {
        const r = await api("/admin/api/settings", {method: "PUT", body: JSON.stringify({smtp: null})});
        if (r.status === 200) {
            toast("SMTP configuration removed");
            setHost("");
            setPort("587");
            setFrom("");
            setUser("");
            setPass("");
            setSecure(false);
        } else toast("Failed", true);
    }

    return (
        <>
            <RowHead title="Settings">
                <button className="btn-sm" onClick={save}>
                    Save changes
                </button>
            </RowHead>

            <div className="card">
                <h3>General</h3>
                <div className="field-grid">
                    <div className="full">
                        <label>Public base URL</label>
                        <input placeholder="https://example.com" value={baseUrl}
                               onChange={(e) => setBaseUrl(e.target.value)}/>
                    </div>
                    <div>
                        <label>Default locale</label>
                        <input placeholder="en" value={locale} onChange={(e) => setLocale(e.target.value)}/>
                    </div>
                    <div>
                        <label>Timezone</label>
                        <input placeholder="UTC" value={tz} onChange={(e) => setTz(e.target.value)}/>
                    </div>
                </div>
            </div>

            <div className="card">
                <h3>Languages</h3>
                <p className="hint">
                    Enable additional content locales for a multi-language site. The default locale
                    (<code>{locale.trim() || "en"}</code>) is always active. With more than one locale, pages gain
                    locale-prefixed URLs (e.g. <code>/fr/about</code>), a switcher, and hreflang tags. Adding a locale
                    takes effect after the site restarts.
                </p>
                <div className="tag-list" style={{display: "flex", flexWrap: "wrap", gap: ".4rem", margin: ".4rem 0"}}>
                    {locales.map((l) => (
                        <span className="tag" key={l}>
                            {l}
                            {l !== (locale.trim() || "en") && (
                                <button
                                    className="iconbtn"
                                    title="Remove locale"
                                    style={{marginLeft: ".3rem"}}
                                    onClick={() => setLocales(locales.filter((x) => x !== l))}
                                >×</button>
                            )}
                        </span>
                    ))}
                </div>
                <div style={{display: "flex", gap: ".5rem", maxWidth: "20rem"}}>
                    <input placeholder="e.g. fr or fr-CA" value={newLocale}
                           onChange={(e) => setNewLocale(e.target.value)}
                           onKeyDown={(e) => {
                               if (e.key === "Enter") {
                                   e.preventDefault();
                                   addLocale();
                               }
                           }}/>
                    <button className="ghost" onClick={addLocale}>Add</button>
                </div>
            </div>

            <div className="card">
                <h3>Maintenance mode</h3>
                <p className="hint">
                    When on, the public site returns HTTP 503 and serves your Maintenance page to every visitor. The
                    admin
                    Studio stays reachable. Edit the page under Pages · System pages.
                </p>
                <label className="dp-check-row">
                    <input type="checkbox" checked={maint} onChange={(e) => setMaint(e.target.checked)}/>
                    <span>Take the public site offline for maintenance</span>
                </label>
            </div>

            <div className="card">
                <h3>Cookie consent</h3>
                <p className="hint">
                    Show a consent banner on the public site. Each choice is recorded (anonymously) for GDPR
                    proof-of-consent. Leave the policy link empty to omit it.
                </p>
                <label className="dp-check-row">
                    <input type="checkbox" checked={consentOn} onChange={(e) => setConsentOn(e.target.checked)}/>
                    <span>Show the cookie-consent banner</span>
                </label>
                <div className="field-grid" style={{marginTop: ".6rem"}}>
                    <div className="full">
                        <label>Banner message</label>
                        <input
                            placeholder="We use cookies to keep this site running…"
                            value={consentMsg}
                            onChange={(e) => setConsentMsg(e.target.value)}
                        />
                    </div>
                    <div className="full">
                        <label>Privacy policy URL</label>
                        <input
                            placeholder="/privacy or https://example.com/privacy"
                            value={consentPolicy}
                            onChange={(e) => setConsentPolicy(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="card">
                <h3>Email (SMTP)</h3>
                <p className="hint">
                    Used for invitations and notifications. The password is sealed in the secrets vault.
                </p>
                {!initial.smtpAvailable && (
                    <div className="notice">
                        Secrets vault not configured — set PRESSH_MASTER_KEY to store SMTP credentials.
                    </div>
                )}
                <div className="field-grid">
                    <div>
                        <label>Host</label>
                        <input value={host} onChange={(e) => setHost(e.target.value)}/>
                    </div>
                    <div>
                        <label>Port</label>
                        <input type="number" value={port} onChange={(e) => setPort(e.target.value)}/>
                    </div>
                    <div>
                        <label>From address</label>
                        <input value={from} onChange={(e) => setFrom(e.target.value)}/>
                    </div>
                    <div>
                        <label>Username</label>
                        <input value={user} onChange={(e) => setUser(e.target.value)}/>
                    </div>
                    <div className="full">
                        <label>Password {smtp.hasPassword && <span className="tag">set</span>}</label>
                        <input
                            type="password"
                            placeholder={smtp.hasPassword ? "unchanged" : "Enter SMTP password"}
                            disabled={!initial.smtpAvailable}
                            value={pass}
                            onChange={(e) => setPass(e.target.value)}
                        />
                    </div>
                    <div className="full">
                        <label className="dp-check-row">
                            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)}/>
                            <span>Use TLS (secure)</span>
                        </label>
                    </div>
                </div>
                <div style={{marginTop: ".6rem"}}>
                    <button className="ghost danger" onClick={clearSmtp}>
                        Remove SMTP config
                    </button>
                </div>
                {error && <div className="alert">{error}</div>}
            </div>
        </>
    );
}
