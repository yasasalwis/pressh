import {useState} from "react";
import {request, usePanelQuery} from "@pressh/panel-kit";

interface Submission {
    id: string;
    formId: string;
    data: Record<string, string | number | boolean>;
    subjectRef: string;
    consent: boolean;
    at: string;
}

interface ListResp {
    items: Submission[];
}

function fmtDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Flattens a submission into label/value rows, leading with subject + consent. */
function rowsFor(s: Submission): [string, string][] {
    const rows: [string, string][] = [];
    if (s.subjectRef) rows.push(["subject", s.subjectRef]);
    rows.push(["consent", s.consent ? "yes" : "no"]);
    for (const [k, v] of Object.entries(s.data ?? {})) rows.push([k, String(v)]);
    return rows;
}

export function App() {
    const {data, loading, error, reload} = usePanelQuery<ListResp>("list");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionErr, setActionErr] = useState<string | null>(null);

    async function remove(id: string) {
        if (!confirm("Permanently delete this submission?")) return;
        setBusyId(id);
        setActionErr(null);
        try {
            await request("remove", {id});
            reload();
        } catch (e) {
            setActionErr(e instanceof Error ? e.message : String(e));
        } finally {
            setBusyId(null);
        }
    }

    const items = data?.items ?? [];

    return (
        <>
            <h2>Form Submissions</h2>
            <p className="muted">
                Entries captured from public forms. Submissions are GDPR-scoped — removing one here erases it from the
                store.
            </p>

            <div className="row" style={{marginBottom: 12}}>
                <button onClick={reload} disabled={loading}>
                    {loading ? "Loading…" : "Refresh"}
                </button>
                {actionErr && <span className="err">{actionErr}</span>}
            </div>

            {error ? (
                <div className="card">
                    <p className="err">Could not load submissions: {error}</p>
                </div>
            ) : loading ? (
                <div className="card">
                    <p className="muted">Loading…</p>
                </div>
            ) : items.length === 0 ? (
                <div className="card">
                    <p className="muted">No submissions yet.</p>
                </div>
            ) : (
                items.map((s) => (
                    <div className="card" key={s.id}>
                        <div className="head">
                            <div>
                                <b>{s.formId}</b>
                                <span className="muted"> · {fmtDate(s.at)}</span>
                            </div>
                            <button className="danger" onClick={() => remove(s.id)} disabled={busyId === s.id}>
                                {busyId === s.id ? "Removing…" : "Remove"}
                            </button>
                        </div>
                        <div className="fields">
                            {rowsFor(s).map(([k, v]) => (
                                <div className="field" key={k}>
                                    <span className="k">{k}</span>
                                    <span className="v">{v}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))
            )}
        </>
    );
}
