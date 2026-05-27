import {api} from "../../api";
import {ErrorCard, Loading, RowHead, fmtDate, useLoader} from "../ui";

interface AuditEntry {
    at: string;
    action: string;
    detail?: unknown;
}

export function Audit() {
    const {data, loading, error, reload} = useLoader(
        async () => (await api<{ items?: AuditEntry[] }>("/admin/api/audit?limit=200")).body.items || [],
    );

    return (
        <>
            <RowHead title="Audit Log">
                <button className="ghost" onClick={reload}>
                    Refresh
                </button>
            </RowHead>
            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorCard message={error}/>
            ) : (
                <div className="card">
                    <p className="hint">
                        Append-only, hash-chained record of every mutation, login, and capability use.
                    </p>
                    {!data || !data.length ? (
                        <div className="empty">
                            <span className="ico">📜</span>No audit entries yet.
                        </div>
                    ) : (
                        data.map((e, i) => (
                            <div className="audit-row" key={i}>
                                <span className="a-time">{fmtDate(e.at)}</span>
                                <span className="a-act">{e.action}</span>
                                <span className="a-det">{e.detail ? JSON.stringify(e.detail) : ""}</span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </>
    );
}
