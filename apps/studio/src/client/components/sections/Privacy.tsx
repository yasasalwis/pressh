import {useState} from "react";
import {api} from "../../api";
import {ConfirmModal, RowHead, useToast} from "../ui";

export function Privacy() {
    const toast = useToast();
    const [subject, setSubject] = useState("");
    const [error, setError] = useState("");
    const [exportJson, setExportJson] = useState<string | null>(null);
    const [tombstone, setTombstone] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);

    async function doExport() {
        setError("");
        setTombstone(null);
        const s = subject.trim();
        if (!s) return setError("Enter a subject reference.");
        const r = await api<{ data?: unknown }>("/admin/api/gdpr/export", {
            method: "POST",
            body: JSON.stringify({subjectRef: s}),
        });
        if (r.status !== 200) return setError("Export failed.");
        setExportJson(JSON.stringify(r.body.data, null, 2));
    }

    async function doErase() {
        setConfirming(false);
        setError("");
        setExportJson(null);
        const s = subject.trim();
        const r = await api<{ data?: { erasedCount?: number; tombstoneId?: string } }>("/admin/api/gdpr/erase", {
            method: "POST",
            body: JSON.stringify({subjectRef: s}),
        });
        if (r.status === 200) {
            const d = r.body.data || {};
            toast("Erased " + (d.erasedCount != null ? d.erasedCount : "") + " record(s)");
            setTombstone(d.tombstoneId || "");
        } else {
            setError("Erase failed.");
        }
    }

    return (
        <>
            <RowHead title="Privacy & GDPR"/>
            <div className="card">
                <h3>Data subject requests</h3>
                <p className="hint">
                    Export or erase all personal data linked to a subject reference (e.g. an email). Erasure is
                    irreversible (crypto-shred + audited tombstone).
                </p>
                <label>Subject reference</label>
                <input placeholder="person@example.com" value={subject} onChange={(e) => setSubject(e.target.value)}/>
                <div style={{display: "flex", gap: ".5rem", marginTop: ".8rem"}}>
                    <button className="btn-sm" onClick={doExport}>
                        Export data
                    </button>
                    <button
                        className="ghost danger"
                        onClick={() => {
                            if (!subject.trim()) return setError("Enter a subject reference.");
                            setConfirming(true);
                        }}
                    >
                        Erase data
                    </button>
                </div>
                {error && <div className="alert">{error}</div>}
                <div style={{marginTop: "1rem"}}>
                    {exportJson != null && (
                        <>
                            <label>Export result</label>
                            <textarea
                                readOnly
                                style={{minHeight: 220, fontFamily: "ui-monospace,monospace", fontSize: ".78rem"}}
                                value={exportJson}
                            />
                        </>
                    )}
                    {tombstone != null && <div className="notice">Erasure complete. Tombstone: {tombstone}</div>}
                </div>
            </div>
            {confirming && (
                <ConfirmModal
                    title="Erase all data?"
                    message={`This permanently erases data for ${subject.trim()}. This cannot be undone.`}
                    confirmLabel="Erase"
                    onConfirm={doErase}
                    onCancel={() => setConfirming(false)}
                />
            )}
        </>
    );
}
