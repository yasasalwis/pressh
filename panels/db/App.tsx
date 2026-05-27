import {useEffect, useState} from "react";
import {request} from "@pressh/panel-kit";

interface DocRow {
    id: string;

    [k: string]: unknown;
}

interface QueryResp {
    items: DocRow[];
    nextCursor: string | null;
}

interface ExportResp {
    truncated?: boolean;

    [k: string]: unknown;
}

export function App() {
    const [collections, setCollections] = useState<string[]>([]);
    const [selected, setSelected] = useState("");
    const [current, setCurrent] = useState("");
    const [rows, setRows] = useState<DocRow[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
    const [busy, setBusy] = useState(false);
    const [exportText, setExportText] = useState<string | null>(null);

    useEffect(() => {
        async function init() {
            try {
                const r = await request<{ collections: string[] }>("listCollections");
                const cols = r.collections || [];
                setCollections(cols);
                if (cols.length) setSelected(cols[0]!);
            } catch (e) {
                setStatus({
                    text: "Could not load collections: " + (e instanceof Error ? e.message : String(e)),
                    err: true
                });
            }
        }

        void init();
    }, []);

    async function loadMore(collection: string, after: string | null, existing: DocRow[]) {
        setBusy(true);
        setStatus({text: "Loading…"});
        try {
            const payload: { collection: string; after?: string } = {collection};
            if (after) payload.after = after;
            const r = await request<QueryResp>("queryCollection", payload);
            const next = existing.concat(r.items || []);
            setRows(next);
            setCursor(r.nextCursor || null);
            setStatus({text: next.length + " record(s)" + (r.nextCursor ? " (more available)" : "")});
        } catch (e) {
            setStatus({text: "Query failed: " + (e instanceof Error ? e.message : String(e)), err: true});
        } finally {
            setBusy(false);
        }
    }

    function loadFirst() {
        if (!selected) {
            setStatus({text: "Pick a collection first."});
            return;
        }
        setCurrent(selected);
        setRows([]);
        setCursor(null);
        void loadMore(selected, null, []);
    }

    async function doExport() {
        setBusy(true);
        setStatus({text: "Building export…"});
        try {
            const r = await request<ExportResp>("exportAll");
            setExportText(JSON.stringify(r, null, 2));
            setStatus({text: "Export ready" + (r.truncated ? " (truncated at cap)" : "") + " — copy the JSON below."});
        } catch (e) {
            setStatus({text: "Export failed: " + (e instanceof Error ? e.message : String(e)), err: true});
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <h2>Data Manager</h2>
            <p className="muted">Read-only browser over your data. No editing, no raw queries.</p>

            <div className="row">
                <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                    {collections.length ? (
                        collections.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))
                    ) : (
                        <option value="">(no collections yet)</option>
                    )}
                </select>
                <button className="primary" onClick={loadFirst} disabled={busy}>
                    View
                </button>
                {cursor && (
                    <button onClick={() => loadMore(current, cursor, rows)} disabled={busy}>
                        Load more
                    </button>
                )}
                <button onClick={doExport} disabled={busy}>
                    Export all (JSON)
                </button>
            </div>

            {status && <div className={status.err ? "err" : "muted"}>{status.text}</div>}

            <div>
                {current && !rows.length && !busy ? (
                    <p className="muted">No records.</p>
                ) : rows.length ? (
                    <table>
                        <thead>
                        <tr>
                            <th>id</th>
                            <th>document</th>
                        </tr>
                        </thead>
                        <tbody>
                        {rows.map((d, i) => (
                            <tr key={d.id ?? i}>
                                <td>{d.id}</td>
                                <td>
                                    <pre>{JSON.stringify(d, null, 2)}</pre>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                ) : null}
            </div>

            {exportText != null && (
                <textarea readOnly aria-label="Exported JSON" value={exportText} autoFocus/>
            )}
        </>
    );
}
