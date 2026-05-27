import {useState} from "react";
import {api, errCode} from "../api";

export function PasswordModal({
                                  forced,
                                  onClose,
                                  onChanged,
                              }: {
    forced: boolean;
    onClose: () => void;
    onChanged: () => void;
}) {
    const [cur, setCur] = useState("");
    const [nw, setNw] = useState("");
    const [cf, setCf] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    async function submit() {
        setError("");
        if (nw.length < 8) return setError("New password must be at least 8 characters.");
        if (nw !== cf) return setError("Passwords do not match.");
        setBusy(true);
        const r = await api("/admin/api/me/password", {
            method: "POST",
            body: JSON.stringify({currentPassword: cur, newPassword: nw}),
        });
        setBusy(false);
        if (r.status !== 200) {
            return setError(errCode(r.body) === "unauthorized" ? "Current password is incorrect." : "Could not update password.");
        }
        onChanged();
    }

    return (
        <div
            className="modal-bg"
            onClick={(e) => {
                if (!forced && e.target === e.currentTarget) onClose();
            }}
        >
            <div className="modal">
                <h3>Change password</h3>
                <p className="hint">Use at least 8 characters.</p>
                {forced && (
                    <div className="notice">You signed in with a temporary password. Choose a new one to continue.</div>
                )}
                <label>Current password</label>
                <input type="password" autoComplete="current-password" value={cur}
                       onChange={(e) => setCur(e.target.value)}/>
                <label>New password</label>
                <input type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)}/>
                <label>Confirm new password</label>
                <input type="password" autoComplete="new-password" value={cf} onChange={(e) => setCf(e.target.value)}/>
                {error && <div className="alert">{error}</div>}
                <div className="actions">
                    {!forced && (
                        <button className="ghost" onClick={onClose}>
                            Cancel
                        </button>
                    )}
                    <button className="btn-sm" onClick={submit} disabled={busy}>
                        Update password
                    </button>
                </div>
            </div>
        </div>
    );
}
