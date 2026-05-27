import {useState} from "react";
import {api, errMessage} from "../api";

interface Enrollment {
    secret: string;
    otpauthUri: string;
}

/**
 * Manage your own TOTP second factor. Enrollment shows the manual-entry key +
 * otpauth URI (no QR dependency), verifies a code, then reveals one-time recovery
 * codes. Disabling requires a current code.
 */
export function MfaModal({
                             enabled,
                             onClose,
                             onChanged,
                         }: {
    enabled: boolean;
    onClose: () => void;
    onChanged: (nowEnabled: boolean) => void;
}) {
    const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
    const [recovery, setRecovery] = useState<string[] | null>(null);
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    async function begin() {
        setError("");
        setBusy(true);
        const r = await api<{ data?: Enrollment }>("/admin/api/auth/mfa/begin", {method: "POST"});
        setBusy(false);
        if (r.status !== 200 || !r.body.data) return setError(errMessage(r.body, "Could not start setup."));
        setEnrollment(r.body.data);
    }

    async function confirm() {
        setError("");
        if (!/^\d{6}$/.test(code.trim())) return setError("Enter the 6-digit code from your app.");
        setBusy(true);
        const r = await api<{ data?: { recoveryCodes: string[] } }>("/admin/api/auth/mfa/confirm", {
            method: "POST",
            body: JSON.stringify({code: code.trim()}),
        });
        setBusy(false);
        if (r.status !== 200 || !r.body.data) return setError(errMessage(r.body, "That code didn't match."));
        setRecovery(r.body.data.recoveryCodes);
        setCode("");
    }

    async function disable() {
        setError("");
        if (!code.trim()) return setError("Enter a current code to disable.");
        setBusy(true);
        const r = await api("/admin/api/auth/mfa/disable", {method: "POST", body: JSON.stringify({code: code.trim()})});
        setBusy(false);
        if (r.status !== 200) return setError(errMessage(r.body, "That code didn't match."));
        onChanged(false);
    }

    return (
        <div className="modal-bg" onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
        }}>
            <div className="modal">
                <h3>Two-factor authentication</h3>

                {recovery ? (
                    <>
                        <div className="notice">
                            Two-factor is on. Save these one-time recovery codes somewhere safe — each works once if you
                            lose your authenticator. They won't be shown again.
                        </div>
                        <pre className="copybox" style={{whiteSpace: "pre-wrap"}}>{recovery.join("\n")}</pre>
                        <div className="actions">
                            <button className="btn-sm" onClick={() => onChanged(true)}>Done</button>
                        </div>
                    </>
                ) : enabled ? (
                    <>
                        <p className="hint">Two-factor is currently <b>on</b>. Enter a current code to turn it
                            off.</p>
                        <label>Authentication code</label>
                        <input inputMode="numeric" autoComplete="one-time-code" placeholder="123456 or a recovery code"
                               value={code} onChange={(e) => setCode(e.target.value)}/>
                        {error && <div className="alert">{error}</div>}
                        <div className="actions">
                            <button className="ghost" onClick={onClose}>Cancel</button>
                            <button className="btn-sm danger" onClick={disable} disabled={busy}>Disable two-factor
                            </button>
                        </div>
                    </>
                ) : enrollment ? (
                    <>
                        <p className="hint">
                            Add this account to an authenticator app (Google Authenticator, Authy, 1Password…), then
                            enter the 6-digit code it shows.
                        </p>
                        <label>Manual entry key</label>
                        <pre className="copybox">{enrollment.secret}</pre>
                        <label>Or import this URI</label>
                        <pre className="copybox"
                             style={{whiteSpace: "pre-wrap", wordBreak: "break-all"}}>{enrollment.otpauthUri}</pre>
                        <label>Code from your app</label>
                        <input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code}
                               onChange={(e) => setCode(e.target.value)}/>
                        {error && <div className="alert">{error}</div>}
                        <div className="actions">
                            <button className="ghost" onClick={onClose}>Cancel</button>
                            <button className="btn-sm" onClick={confirm} disabled={busy}>Verify & enable</button>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="hint">
                            Add a second factor so a stolen password isn't enough to sign in. You'll need an
                            authenticator app.
                        </p>
                        {error && <div className="alert">{error}</div>}
                        <div className="actions">
                            <button className="ghost" onClick={onClose}>Cancel</button>
                            <button className="btn-sm" onClick={begin} disabled={busy}>Set up two-factor</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
