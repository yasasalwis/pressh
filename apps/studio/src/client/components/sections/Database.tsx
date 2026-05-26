import {useCallback, useEffect, useRef, useState} from "react";
import {api} from "../../api";
import {ConfirmModal, ErrorCard, Loading, Modal, RowHead, useToast} from "../ui";

interface ConnectorField {
    key: string;
    label: string;
    placeholder?: string;
    required?: boolean;
    secret?: boolean;
}

interface Connector {
    backend: string;
    label: string;
    description: string;
    requiresVault?: boolean;
    fields?: ConnectorField[];
}

interface Migration {
    phase: string;
    to?: string;
    error?: string;
    records?: number;
    collections?: number;
}

interface DbStatus {
    connectors?: Connector[];
    vaultConfigured?: boolean;
    active?: { backend?: string };
    migration?: Migration | null;
    pendingCleanup?: { backend?: string; backupPath?: string; autoRemove?: boolean } | null;
}

const MIG_STEPS: [string, string][] = [
    ["testing", "Test connection"],
    ["locking", "Maintenance mode"],
    ["copying", "Copy data"],
    ["verifying", "Verify"],
    ["backing-up", "Back up old store"],
    ["cutover", "Cut over"],
    ["awaiting-restart", "Restart"],
];
const activePhase = (p: string | undefined) => !!p && p !== "done" && p !== "failed";

export function Database() {
    const [status, setStatus] = useState<DbStatus | null>(null);
    const [state, setState] = useState<"loading" | "notEnabled" | "error" | "ready">("loading");
    const [migrateFor, setMigrateFor] = useState<Connector | null>(null);
    const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const restartTries = useRef(0);

    const stopPoll = useCallback(() => {
        if (pollRef.current) {
            clearTimeout(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    const load = useCallback(async () => {
        stopPoll();
        const r = await api<{ data?: DbStatus }>("/admin/api/db/status");
        if (r.status === 404) return setState("notEnabled");
        if (r.status !== 200) return setState("error");
        setStatus(r.body.data || {});
        setState("ready");
    }, [stopPoll]);

    useEffect(() => {
        void load();
        return stopPoll;
    }, [load, stopPoll]);

    const phase = status?.migration?.phase;

    // Poll while a migration is in progress or while awaiting restart.
    useEffect(() => {
        if (state !== "ready") return;
        if (phase === "awaiting-restart") {
            restartTries.current = 0;
            const tick = async () => {
                restartTries.current++;
                const r = await api<{ data?: DbStatus }>("/admin/api/db/status").catch(() => null);
                if (r && r.status === 200) {
                    const mig = r.body.data?.migration;
                    if (!mig || !activePhase(mig.phase)) {
                        location.reload();
                        return;
                    }
                }
                pollRef.current = setTimeout(tick, 2500);
            };
            pollRef.current = setTimeout(tick, 2500);
            return stopPoll;
        }
        if (activePhase(phase)) {
            const tick = async () => {
                const r = await api<{ data?: DbStatus }>("/admin/api/db/migrate/status").catch(() => null);
                if (!r || r.status !== 200) {
                    pollRef.current = setTimeout(tick, 1500);
                    return;
                }
                const mig = r.body.data?.migration;
                if (!mig || !activePhase(mig.phase)) {
                    void load();
                    return;
                }
                setStatus((prev) => ({...(prev || {}), migration: mig}));
                pollRef.current = setTimeout(tick, 1500);
            };
            pollRef.current = setTimeout(tick, 1500);
            return stopPoll;
        }
        return undefined;
    }, [state, phase, load, stopPoll]);

    if (state === "loading") return <Loading/>;
    if (state === "notEnabled")
        return (
            <div className="card">
                <div className="empty">
                    <span className="ico">💾</span>The database manager is not enabled on this server.
                </div>
            </div>
        );
    if (state === "error" || !status) return <ErrorCard message="Could not load database status."/>;

    const mig = status.migration;
    if (mig && activePhase(mig.phase)) {
        if (mig.phase === "awaiting-restart") {
            return (
                <>
                    <RowHead title="Finishing up"/>
                    <div className="card">
                        <div className="loading">Cutover complete — restarting Pressh on the new database…</div>
                        <p className="hint">This usually takes a few seconds. The page will refresh automatically.</p>
                    </div>
                </>
            );
        }
        return <Progress mig={mig}/>;
    }
    if (status.pendingCleanup) return <PendingCleanup status={status} onChanged={load}/>;

    return (
        <Connectors
            status={status}
            onMigrate={setMigrateFor}
            migrateFor={migrateFor}
            onCloseMigrate={() => setMigrateFor(null)}
            onStarted={() => {
                setMigrateFor(null);
                load();
            }}
        />
    );

    function Progress({mig}: { mig: Migration }) {
        const order = MIG_STEPS.map((s) => s[0]);
        const cur = order.indexOf(mig.phase);
        return (
            <>
                <RowHead title={"Migrating to " + (mig.to || "")}/>
                <div className="card">
                    <p className="hint">
                        Migration in progress. The public site is in maintenance mode and admin changes are paused until
                        this
                        completes. Do not close this tab.
                    </p>
                    <div className="db-steps">
                        {MIG_STEPS.map(([key, label]) => {
                            const me = order.indexOf(key);
                            const cls = me < cur ? "done" : me === cur ? "active" : "";
                            const mark = me < cur ? "✓" : me === cur ? "…" : "";
                            return (
                                <div className={"db-step " + cls} key={key}>
                                    <span className="db-step-mark">{mark}</span>
                                    {label}
                                </div>
                            );
                        })}
                    </div>
                    {mig.records ? (
                        <p className="meta">
                            {mig.records} records copied across {mig.collections} collections.
                        </p>
                    ) : null}
                </div>
            </>
        );
    }
}

function Connectors({
                        status,
                        onMigrate,
                        migrateFor,
                        onCloseMigrate,
                        onStarted,
                    }: {
    status: DbStatus;
    onMigrate: (c: Connector) => void;
    migrateFor: Connector | null;
    onCloseMigrate: () => void;
    onStarted: () => void;
}) {
    const active = status.active?.backend || "fs";
    const vault = !!status.vaultConfigured;
    return (
        <>
            <RowHead title="Database"/>
            <div className="card">
                <p className="hint">
                    Choose where Pressh stores your content. The default is the built-in File store. Switching copies
                    all your
                    data to the new database, verifies it, takes a backup, then restarts Pressh on the new backend.
                </p>
                {!vault && (
                    <div className="notice">
                        The secrets vault is not configured. Set <b>PRESSH_MASTER_KEY</b> to store database credentials
                        securely —
                        until then only the File and SQLite backends are available.
                    </div>
                )}
                {status.migration?.phase === "failed" && (
                    <div className="alert">
                        Last migration failed: {status.migration.error || "unknown error"}. Nothing was changed — you
                        are still on
                        the current database.
                    </div>
                )}
            </div>
            <div className="db-grid">
                {(status.connectors || []).map((c) => {
                    const isActive = c.backend === active;
                    const blocked = c.requiresVault && !vault;
                    return (
                        <div className={"db-card" + (isActive ? " active" : "")} key={c.backend}>
                            <div className="db-card-head">
                                <b>{c.label}</b>
                                {isActive && (
                                    <span className="tag" style={{background: "#16a34a22", color: "#16a34a"}}>
                    Active
                  </span>
                                )}
                            </div>
                            <p className="hint">{c.description}</p>
                            <div className="db-card-foot">
                                {isActive ? (
                                    <span className="meta">In use</span>
                                ) : blocked ? (
                                    <button className="btn-sm" disabled title="Set PRESSH_MASTER_KEY first">
                                        Vault required
                                    </button>
                                ) : (
                                    <button className="btn-sm" onClick={() => onMigrate(c)}>
                                        {c.backend === "fs" ? "Switch to File" : "Switch to this"}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            {migrateFor && <MigrateModal connector={migrateFor} onClose={onCloseMigrate} onStarted={onStarted}/>}
        </>
    );
}

function MigrateModal({connector, onClose, onStarted}: {
    connector: Connector;
    onClose: () => void;
    onStarted: () => void
}) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [removeOld, setRemoveOld] = useState(true);
    const [testResult, setTestResult] = useState<{ msg: string; ok: boolean } | null>(null);
    const [testing, setTesting] = useState(false);
    const [error, setError] = useState("");
    const [confirming, setConfirming] = useState(false);

    const set = (k: string, v: string) => setValues((prev) => ({...prev, [k]: v}));

    async function test() {
        setTesting(true);
        setTestResult(null);
        const r = await api<{ error?: { message?: string } }>("/admin/api/db/test", {
            method: "POST",
            body: JSON.stringify({backend: connector.backend, values}),
        });
        setTesting(false);
        if (r.status === 200) setTestResult({msg: "✓ Connection succeeded", ok: true});
        else setTestResult({msg: "✗ " + (r.body.error?.message || "Connection failed"), ok: false});
    }

    function confirmMigrate() {
        for (const f of connector.fields || []) {
            if (f.required && !(values[f.key] || "").trim()) return setError(f.label + " is required.");
        }
        setError("");
        setConfirming(true);
    }

    async function start() {
        setConfirming(false);
        const r = await api<{ error?: { message?: string } }>("/admin/api/db/migrate", {
            method: "POST",
            body: JSON.stringify({backend: connector.backend, values, removeOld}),
        });
        if (r.status !== 200) {
            setError(r.body.error?.message || "Failed to start.");
            return;
        }
        onStarted();
    }

    return (
        <>
            <Modal onClose={onClose}>
                <h3>Switch to {connector.label}</h3>
                <p className="hint">{connector.description}</p>
                {(connector.fields || []).map((f) => (
                    <div key={f.key}>
                        <label>
                            {f.label}
                            {f.required ? " *" : ""}
                        </label>
                        <input
                            type={f.secret ? "password" : "text"}
                            placeholder={f.placeholder || ""}
                            autoComplete={f.secret ? "off" : undefined}
                            value={values[f.key] || ""}
                            onChange={(e) => set(f.key, e.target.value)}
                        />
                    </div>
                ))}
                {testResult && (
                    <div className="meta" style={{margin: ".5rem 0", color: testResult.ok ? "#16a34a" : "#e11d48"}}>
                        {testResult.msg}
                    </div>
                )}
                <label className="dp-check-row">
                    <input type="checkbox" checked={removeOld} onChange={(e) => setRemoveOld(e.target.checked)}/>
                    <span>Back up, then remove the current store after a verified switch (recommended)</span>
                </label>
                <div className="notice">
                    This takes the public site offline briefly, copies all data, switches over, and restarts Pressh.
                </div>
                {error && <div className="alert">{error}</div>}
                <div className="actions">
                    <button className="ghost" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="ghost" onClick={test} disabled={testing}>
                        {testing ? "Testing…" : "Test connection"}
                    </button>
                    <button className="btn-sm" onClick={confirmMigrate}>
                        Start migration
                    </button>
                </div>
            </Modal>
            {confirming && (
                <ConfirmModal
                    title={"Migrate to " + connector.label + "?"}
                    message={
                        "Pressh will go offline briefly, copy all data, switch over, and restart. " +
                        (removeOld ? "The current store will be backed up, then removed." : "The current store will be kept.")
                    }
                    confirmLabel="Migrate"
                    onConfirm={start}
                    onCancel={() => setConfirming(false)}
                />
            )}
        </>
    );
}

function PendingCleanup({status, onChanged}: { status: DbStatus; onChanged: () => void }) {
    const toast = useToast();
    const pc = status.pendingCleanup || {};
    const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
    const [busy, setBusy] = useState(false);

    const cleanup = useCallback(
        async (keep: boolean) => {
            setBusy(true);
            const r = await api<{ data?: { removed?: boolean; reason?: string } }>("/admin/api/db/cleanup", {
                method: "POST",
                body: JSON.stringify({keep}),
            });
            setBusy(false);
            if (r.status !== 200) return toast("Could not complete cleanup", true);
            const d = r.body.data || {};
            if (keep) {
                toast("Previous store kept");
                return onChanged();
            }
            if (d.removed) {
                toast("Previous store removed");
                return onChanged();
            }
            setMsg({text: d.reason || "The previous store was kept as a safeguard.", err: true});
        },
        [toast, onChanged],
    );

    useEffect(() => {
        if (pc.autoRemove) {
            setMsg({text: "Removing the previous store as requested…"});
            void cleanup(false);
        }
    }, []);

    return (
        <>
            <RowHead title="Database"/>
            <div className="card">
                <h3>Migration complete</h3>
                <p className="hint">
                    Pressh is now running on the <b>{status.active?.backend || ""}</b> backend. The previous{" "}
                    <b>{pc.backend || ""}</b> store has been retained so you can roll back if needed.
                </p>
                {pc.backupPath && (
                    <p className="meta">
                        A backup was saved to <code>{pc.backupPath}</code>.
                    </p>
                )}
                <div className="actions">
                    <button className="ghost" onClick={() => cleanup(true)} disabled={busy}>
                        Keep it
                    </button>
                    <button className="btn-sm danger" onClick={() => cleanup(false)} disabled={busy}>
                        Remove previous store
                    </button>
                </div>
                {msg && (
                    <div className="meta" style={{marginTop: ".5rem", color: msg.err ? "#e11d48" : undefined}}>
                        {msg.text}
                    </div>
                )}
            </div>
        </>
    );
}
