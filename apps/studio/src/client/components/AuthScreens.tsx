import {type FormEvent, type ReactNode, useState} from "react";
import {api, errCode, errMessage} from "../api";
import {toggleTheme} from "../theme";

const STRENGTH_W = [0, 25, 45, 65, 85, 100];
const STRENGTH_C = ["transparent", "#e11d48", "#d97706", "#d97706", "#16a34a", "#16a34a"];
const STRENGTH_L = ["", "Weak", "Fair", "Fair", "Strong", "Very strong"];

function passwordScore(v: string): number {
    let s = 0;
    if (v.length >= 8) s++;
    if (v.length >= 12) s++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
    if (/[0-9]/.test(v)) s++;
    if (/[^A-Za-z0-9]/.test(v)) s++;
    return s;
}

function Strength({value}: { value: string }) {
    const s = passwordScore(value);
    return (
        <>
            <div className="meter">
                <span style={{width: (STRENGTH_W[s] ?? 0) + "%", background: STRENGTH_C[s] ?? "transparent"}}/>
            </div>
            <div className="meter-label">{value ? (STRENGTH_L[s] ?? "") : ""}</div>
        </>
    );
}

function AuthLayout({children}: { children: ReactNode }) {
    return (
        <>
            <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
                &#9681;
            </button>
            <section className="center">
                <div className="auth-card">
                    <div className="brand">
                        <div className="logo">P</div>
                        <div>
                            <h1>Pressh</h1>
                            <p>Secure-by-default CMS</p>
                        </div>
                    </div>
                    {children}
                </div>
            </section>
        </>
    );
}

export function Setup({onAuthed}: { onAuthed: () => void }) {
    const [email, setEmail] = useState("");
    const [pw, setPw] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    async function submit(e: FormEvent) {
        e.preventDefault();
        setError("");
        if (!email.trim()) return setError("Please enter an email address.");
        if (pw.length < 8) return setError("Password must be at least 8 characters.");
        if (pw !== confirm) return setError("Passwords do not match.");
        setBusy(true);
        const r = await api("/admin/api/setup", {
            method: "POST",
            body: JSON.stringify({email: email.trim(), password: pw})
        });
        setBusy(false);
        if (r.status === 200) return onAuthed();
        setError(errMessage(r.body, "Setup failed."));
    }

    return (
        <AuthLayout>
            <h2>Welcome aboard</h2>
            <p className="sub">Create your administrator account to get started — this only happens once.</p>
            <form onSubmit={submit}>
                <label>Email</label>
                <input type="email" autoComplete="username" placeholder="you@example.com" value={email}
                       onChange={(e) => setEmail(e.target.value)}/>
                <label>Password</label>
                <input type="password" autoComplete="new-password" placeholder="At least 8 characters" value={pw}
                       onChange={(e) => setPw(e.target.value)}/>
                <Strength value={pw}/>
                <label>Confirm password</label>
                <input type="password" autoComplete="new-password" placeholder="Re-enter password" value={confirm}
                       onChange={(e) => setConfirm(e.target.value)}/>
                {error && <div className="alert">{error}</div>}
                <button className="btn" type="submit" disabled={busy}>
                    {busy ? "Creating account…" : "Create account & sign in"}
                </button>
            </form>
            <p className="foot">
                Plugins run <b>sandboxed</b>. Your data stays yours.
            </p>
        </AuthLayout>
    );
}

export function Login({onAuthed}: { onAuthed: () => void }) {
    const [email, setEmail] = useState("");
    const [pw, setPw] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    // When the account has 2FA, the password step returns a challenge and we ask
    // for the authenticator code before any session cookie is set.
    const [challenge, setChallenge] = useState("");
    const [code, setCode] = useState("");

    async function submitPassword(e: FormEvent) {
        e.preventDefault();
        setError("");
        setBusy(true);
        const r = await api<{ mfaRequired?: boolean; challenge?: string }>("/admin/api/auth/login", {
            method: "POST",
            body: JSON.stringify({email: email.trim(), password: pw})
        });
        setBusy(false);
        if (r.status === 200 && r.body.mfaRequired && r.body.challenge) {
            setChallenge(r.body.challenge);
            return;
        }
        if (r.status === 200) return onAuthed();
        setError("Invalid email or password.");
    }

    async function submitCode(e: FormEvent) {
        e.preventDefault();
        setError("");
        setBusy(true);
        const r = await api("/admin/api/auth/mfa/verify", {
            method: "POST",
            body: JSON.stringify({challenge, code: code.trim()})
        });
        setBusy(false);
        if (r.status === 200) return onAuthed();
        setError("That code didn't match. Try again.");
    }

    if (challenge) {
        return (
            <AuthLayout>
                <h2>Two-factor authentication</h2>
                <p className="sub">Enter the 6-digit code from your authenticator app.</p>
                <form onSubmit={submitCode}>
                    <label>Authentication code</label>
                    <input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        autoFocus
                        placeholder="123456 or a recovery code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                    />
                    {error && <div className="alert">{error}</div>}
                    <button className="btn" type="submit" disabled={busy}>
                        {busy ? "Verifying…" : "Verify & sign in"}
                    </button>
                </form>
                <p className="foot">
                    Lost your device? Use a recovery code, or{" "}
                    <a href="#" onClick={(e) => {
                        e.preventDefault();
                        setChallenge("");
                        setCode("");
                        setError("");
                    }}><b>start over</b></a>.
                </p>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout>
            <h2>Sign in</h2>
            <p className="sub">Welcome back. Sign in to your Studio.</p>
            <form onSubmit={submitPassword}>
                <label>Email</label>
                <input type="email" autoComplete="username" placeholder="you@example.com" value={email}
                       onChange={(e) => setEmail(e.target.value)}/>
                <label>Password</label>
                <input type="password" autoComplete="current-password" placeholder="Your password" value={pw}
                       onChange={(e) => setPw(e.target.value)}/>
                {error && <div className="alert">{error}</div>}
                <button className="btn" type="submit" disabled={busy}>
                    {busy ? "Signing in…" : "Sign in"}
                </button>
            </form>
            <p className="foot">Pressh Studio</p>
        </AuthLayout>
    );
}

export function AcceptInvite({token, onAuthed}: { token: string; onAuthed: () => void }) {
    const [pw, setPw] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    async function submit(e: FormEvent) {
        e.preventDefault();
        setError("");
        if (pw.length < 8) return setError("Password must be at least 8 characters.");
        if (pw !== confirm) return setError("Passwords do not match.");
        setBusy(true);
        const r = await api("/admin/api/invite/accept", {method: "POST", body: JSON.stringify({token, password: pw})});
        setBusy(false);
        if (r.status === 200) {
            location.hash = "#/dashboard";
            return onAuthed();
        }
        setError(errCode(r.body) === "unauthorized" ? "This invitation is invalid or has expired." : "Could not activate account.");
    }

    return (
        <AuthLayout>
            <h2>Accept your invitation</h2>
            <p className="sub">Set a password to activate your account and sign in.</p>
            <form onSubmit={submit}>
                <label>Password</label>
                <input type="password" autoComplete="new-password" placeholder="At least 8 characters" value={pw}
                       onChange={(e) => setPw(e.target.value)}/>
                <Strength value={pw}/>
                <label>Confirm password</label>
                <input type="password" autoComplete="new-password" placeholder="Re-enter password" value={confirm}
                       onChange={(e) => setConfirm(e.target.value)}/>
                {error && <div className="alert">{error}</div>}
                <button className="btn" type="submit" disabled={busy}>
                    {busy ? "Activating…" : "Activate & sign in"}
                </button>
            </form>
            <p className="foot">
                Already have an account?{" "}
                <a
                    href="#/"
                    onClick={() => {
                        location.hash = "";
                        location.reload();
                    }}
                >
                    <b>Sign in</b>
                </a>
            </p>
        </AuthLayout>
    );
}
