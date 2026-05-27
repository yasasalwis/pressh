// Cookie-consent banner (GDPR). Rendered entirely from the bundled client so it
// stays within the site's strict CSP (no inline script/style) — styling ships in
// consent.css. Config arrives as a CSP-safe JSON payload (#pressh-consent) the
// server injects only when the operator enabled the banner.
//
// The choice is remembered in a first-party cookie (`pressh_consent`) carrying a
// random, PII-free consent id; each Accept/Decline is also recorded server-side
// via POST /api/consent (keyed by that id) for auditable proof of consent.
import "./consent.css";

const COOKIE = "pressh_consent";
const ONE_YEAR = 31_536_000;

interface ConsentConfig {
    message: string;
    policyUrl: string;
}

declare global {
    interface Window {
        presshConsent?: { granted: boolean };
    }
}

function readConfig(): ConsentConfig | null {
    const el = document.getElementById("pressh-consent");
    if (!el?.textContent) return null;
    try {
        const cfg = JSON.parse(el.textContent) as ConsentConfig;
        if (typeof cfg.message !== "string") return null;
        return cfg;
    } catch {
        return null;
    }
}

function readCookie(): string | null {
    const m = document.cookie.match(/(?:^|;\s*)pressh_consent=([^;]+)/u);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function writeCookie(value: string): void {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE}=${encodeURIComponent(value)}; Max-Age=${ONE_YEAR}; Path=/; SameSite=Lax${secure}`;
}

/** Only http(s) and site-relative links are allowed as the policy href. */
function safePolicyUrl(url: string): string | null {
    return /^(https?:\/\/|\/)/u.test(url) ? url : null;
}

function record(consentId: string, granted: boolean): void {
    // Fire-and-forget; the UI never blocks on the audit write.
    void fetch("/api/consent", {
        method: "POST",
        credentials: "same-origin",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({subjectRef: consentId, scope: "cookies", granted}),
    }).catch(() => undefined);
}

export function initConsentBanner(): void {
    const cfg = readConfig();
    if (!cfg) return; // banner disabled / no config

    const existing = readCookie();
    if (existing) {
        window.presshConsent = {granted: existing.startsWith("granted")};
        return;
    }

    const bar = document.createElement("div");
    bar.className = "pressh-consent";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Cookie consent");

    const text = document.createElement("p");
    text.className = "pressh-consent__msg";
    text.textContent = cfg.message;
    const href = cfg.policyUrl ? safePolicyUrl(cfg.policyUrl) : null;
    if (href) {
        const link = document.createElement("a");
        link.href = href;
        link.textContent = "Learn more";
        link.className = "pressh-consent__link";
        text.append(" ", link);
    }

    const actions = document.createElement("div");
    actions.className = "pressh-consent__actions";

    const decline = document.createElement("button");
    decline.type = "button";
    decline.className = "pressh-consent__btn pressh-consent__btn--ghost";
    decline.textContent = "Decline";

    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "pressh-consent__btn";
    accept.textContent = "Accept";

    function choose(granted: boolean): void {
        const consentId =
            typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : String(Date.now()) + Math.random().toString(36).slice(2);
        writeCookie(`${granted ? "granted" : "denied"}.${consentId}`);
        window.presshConsent = {granted};
        record(consentId, granted);
        bar.remove();
    }

    decline.addEventListener("click", () => choose(false));
    accept.addEventListener("click", () => choose(true));

    actions.append(decline, accept);
    bar.append(text, actions);
    document.body.appendChild(bar);
}
