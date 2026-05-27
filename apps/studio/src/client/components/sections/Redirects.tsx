import {useState} from "react";
import {api, errMessage} from "../../api";
import {ConfirmModal, ErrorCard, fmtDate, Loading, RowHead, useLoader, useToast} from "../ui";

interface RedirectRow {
    id: string;
    from: string;
    to: string;
    code: number;
    createdAt: string;
}

export function Redirects() {
    const toast = useToast();
    const {data, loading, error, reload} = useLoader(async () => {
        const r = await api<{ data?: { items?: RedirectRow[] } }>("/admin/api/redirects");
        return r.body.data?.items ?? [];
    });
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [code, setCode] = useState("301");
    const [formError, setFormError] = useState("");
    const [deleting, setDeleting] = useState<RedirectRow | null>(null);

    async function add() {
        setFormError("");
        if (!from.trim() || !to.trim()) return setFormError("Both source and target are required.");
        const r = await api("/admin/api/redirects", {
            method: "POST",
            body: JSON.stringify({from: from.trim(), to: to.trim(), code: Number(code)}),
        });
        if (r.status === 200) {
            toast("Redirect added");
            setFrom("");
            setTo("");
            setCode("301");
            reload();
        } else {
            setFormError(errMessage(r.body, "Could not add redirect."));
        }
    }

    async function remove(row: RedirectRow) {
        setDeleting(null);
        const r = await api(`/admin/api/redirects/${row.id}`, {method: "DELETE"});
        if (r.status === 200) {
            toast("Redirect removed");
            reload();
        } else {
            toast("Delete failed", true);
        }
    }

    return (
        <>
            <RowHead title="Redirects"/>

            <div className="card">
                <h3>Add a redirect</h3>
                <p className="hint">
                    Sends visitors from an old path to a new location when the original page no longer exists.
                    Source must be a site path (e.g. <code>/old-page</code>); target may be a path or a full URL.
                </p>
                <div className="field-grid">
                    <div>
                        <label>From (source path)</label>
                        <input placeholder="/old-page" value={from} onChange={(e) => setFrom(e.target.value)}/>
                    </div>
                    <div>
                        <label>To (target)</label>
                        <input placeholder="/new-page" value={to} onChange={(e) => setTo(e.target.value)}/>
                    </div>
                    <div>
                        <label>Type</label>
                        <select value={code} onChange={(e) => setCode(e.target.value)}>
                            <option value="301">301 — Permanent</option>
                            <option value="302">302 — Temporary</option>
                        </select>
                    </div>
                </div>
                {formError && <div className="alert">{formError}</div>}
                <div style={{marginTop: ".6rem"}}>
                    <button className="btn-sm" onClick={add}>Add redirect</button>
                </div>
            </div>

            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorCard message={error}/>
            ) : (
                <div className="card">
                    {!data?.length ? (
                        <div className="empty">No redirects yet.</div>
                    ) : (
                        <table className="tbl">
                            <thead>
                            <tr>
                                <th>From</th>
                                <th>To</th>
                                <th>Type</th>
                                <th>Added</th>
                                <th></th>
                            </tr>
                            </thead>
                            <tbody>
                            {data.map((r) => (
                                <tr key={r.id}>
                                    <td><b>{r.from}</b></td>
                                    <td>{r.to}</td>
                                    <td><span className="tag">{r.code}</span></td>
                                    <td className="meta">{fmtDate(r.createdAt)}</td>
                                    <td className="actions">
                                        <button className="iconbtn danger" onClick={() => setDeleting(r)}>Remove
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {deleting && (
                <ConfirmModal
                    title="Remove redirect?"
                    message={`Stop redirecting ${deleting.from} → ${deleting.to}.`}
                    confirmLabel="Remove"
                    onConfirm={() => remove(deleting)}
                    onCancel={() => setDeleting(null)}
                />
            )}
        </>
    );
}
