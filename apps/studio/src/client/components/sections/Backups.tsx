import {useState} from "react";
import {api} from "../../api";
import {ErrorCard, fmtDate, Loading, Modal, RowHead, useLoader, useToast} from "../ui";

interface BackupItem {
    name: string;
    createdAt: string;
    sizeBytes: number;
}

interface BackupsData {
    configured: boolean;
    dir?: string;
    intervalMs?: number;
    keep?: number;
    items?: BackupItem[];
}

interface Verification {
    ok: boolean;
    collections: Record<string, number>;
    totalRecords: number;
    message: string;
}

function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function humanInterval(ms: number): string {
    const h = ms / 3_600_000;
    if (h >= 1) return `${h % 1 === 0 ? h : h.toFixed(1)} hour${h === 1 ? "" : "s"}`;
    return `${Math.round(ms / 60_000)} min`;
}

export function Backups() {
    const toast = useToast();
    const {data, loading, error, reload} = useLoader<BackupsData>(
        async () => (await api<{ data?: BackupsData }>("/admin/api/backups")).body.data || {configured: false},
    );
    const [busy, setBusy] = useState(false);
    const [verification, setVerification] = useState<Verification | null>(null);

    async function runNow() {
        setBusy(true);
        const r = await api<{ data?: { items: number } }>("/admin/api/backups/run", {method: "POST"});
        setBusy(false);
        if (r.status === 200) {
            toast("Backup created");
            reload();
        } else {
            toast("Backup failed", true);
        }
    }

    async function runDrill() {
        setBusy(true);
        const r = await api<{ data?: Verification }>("/admin/api/backups/verify", {
            method: "POST",
            body: JSON.stringify({}),
        });
        setBusy(false);
        if (r.status === 200 && r.body.data) setVerification(r.body.data);
        else toast("Restore drill failed", true);
    }

    if (loading) return <Loading/>;
    if (error) return <ErrorCard message={error}/>;

    return (
        <>
            <RowHead title="Backups">
                {data?.configured && (
                    <>
                        <button className="ghost" onClick={runDrill} disabled={busy}>
                            Run restore drill
                        </button>
                        <button className="btn-sm" onClick={runNow} disabled={busy}>
                            {busy ? "Working…" : "Back up now"}
                        </button>
                    </>
                )}
            </RowHead>

            {!data?.configured ? (
                <div className="card">
                    <div className="empty">
                        <span className="ico">💾</span>
                        Scheduled backups are not configured. Set <code>PRESSH_BACKUP_DIR</code> (ideally a mounted
                        offsite volume) to enable automatic backups, then restart the Studio.
                    </div>
                </div>
            ) : (
                <>
                    <div className="card">
                        <h3>Schedule</h3>
                        <p className="hint">
                            Backs up content, media, the secrets vault, and the audit log every{" "}
                            <b>{humanInterval(data.intervalMs ?? 0)}</b>, keeping the newest <b>{data.keep}</b>. Point
                            the destination at offsite storage for disaster recovery.
                        </p>
                        <div className="copybox">
                            <input type="text" readOnly value={data.dir ?? ""}/>
                        </div>
                    </div>

                    <div className="card">
                        {!data.items?.length ? (
                            <div className="empty">No backups yet. Use “Back up now” to create the first one.</div>
                        ) : (
                            <table className="tbl">
                                <thead>
                                <tr>
                                    <th>Backup</th>
                                    <th>Created</th>
                                    <th>Size</th>
                                </tr>
                                </thead>
                                <tbody>
                                {data.items.map((b) => (
                                    <tr key={b.name}>
                                        <td><b>{b.name}</b></td>
                                        <td className="meta">{fmtDate(b.createdAt)}</td>
                                        <td className="meta">{humanSize(b.sizeBytes)}</td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </>
            )}

            {verification && (
                <Modal onClose={() => setVerification(null)}>
                    <h3>Restore drill</h3>
                    <p className="hint">
                        The latest backup was restored into a sandbox (your live data was untouched).
                    </p>
                    <div className={"notice" + (verification.ok ? "" : " danger")}>
                        {verification.ok ? "✓ " : "✗ "}
                        {verification.message} {verification.totalRecords} record(s) across{" "}
                        {Object.keys(verification.collections).length} collection(s).
                    </div>
                    <div className="actions">
                        <button className="btn-sm" onClick={() => setVerification(null)}>Done</button>
                    </div>
                </Modal>
            )}
        </>
    );
}
