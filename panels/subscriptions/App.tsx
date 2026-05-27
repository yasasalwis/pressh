import {useState} from "react";
import {request, usePanelQuery} from "@pressh/panel-kit";

interface Subscriber {
    id: string;
    email: string;
    memberId: string | null;
    status: "pending" | "confirmed" | "unsubscribed";
    confirmedAt: string | null;
    unsubscribedAt: string | null;
    createdAt: string;
}

interface ListResp {
    items: Subscriber[];
    total: number;
}

interface StatsResp {
    pending: number;
    confirmed: number;
    unsubscribed: number;
    total: number;
}

type StatusFilter = "pending" | "confirmed" | "unsubscribed" | "all";

function fmtDate(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function StatusBadge({status}: { status: Subscriber["status"] }) {
    const colours: Record<Subscriber["status"], string> = {
        pending: "#d97706",
        confirmed: "#16a34a",
        unsubscribed: "#6b7280",
    };
    return (
        <span style={{color: colours[status], fontWeight: 600, fontSize: 12}}>
            {status.toUpperCase()}
        </span>
    );
}

export function App() {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("confirmed");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionErr, setActionErr] = useState<string | null>(null);

    const queryPayload = statusFilter === "all" ? {} : {status: statusFilter};

    const {data: listData, loading: listLoading, error: listError, reload} = usePanelQuery<ListResp>(
        "list",
        queryPayload,
        [statusFilter],
    );

    const {data: stats} = usePanelQuery<StatsResp>("getStats", {}, []);

    async function handleRemove(id: string, email: string) {
        if (!confirm(`Permanently delete subscriber ${email}? This cannot be undone.`)) return;
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

    const items = listData?.items ?? [];
    const tabs: { label: string; value: StatusFilter }[] = [
        {label: "Confirmed", value: "confirmed"},
        {label: "Pending", value: "pending"},
        {label: "Unsubscribed", value: "unsubscribed"},
        {label: "All", value: "all"},
    ];

    return (
        <>
            <h2>Subscribers</h2>
            <p className="muted">
                Double opt-in subscribers. Only <strong>confirmed</strong> addresses receive mailings.
            </p>

            {/* Stats row */}
            {stats && (
                <div className="stats">
                    <div className="stat">
                        <div className="num" style={{color: "#16a34a"}}>{stats.confirmed}</div>
                        <div className="label">Confirmed</div>
                    </div>
                    <div className="stat">
                        <div className="num" style={{color: "#d97706"}}>{stats.pending}</div>
                        <div className="label">Pending</div>
                    </div>
                    <div className="stat">
                        <div className="num" style={{color: "#6b7280"}}>{stats.unsubscribed}</div>
                        <div className="label">Unsubscribed</div>
                    </div>
                    <div className="stat">
                        <div className="num">{stats.total}</div>
                        <div className="label">Total</div>
                    </div>
                </div>
            )}

            {/* Filter tabs */}
            <div className="row" style={{marginBottom: 12, gap: 4}}>
                {tabs.map((t) => (
                    <button
                        key={t.value}
                        onClick={() => setStatusFilter(t.value)}
                        style={{
                            background: statusFilter === t.value ? "#111" : undefined,
                            color: statusFilter === t.value ? "#fff" : undefined,
                            borderColor: statusFilter === t.value ? "#111" : undefined,
                        }}
                    >
                        {t.label}
                    </button>
                ))}
                <button onClick={reload} disabled={listLoading} style={{marginLeft: "auto"}}>
                    {listLoading ? "Loading…" : "Refresh"}
                </button>
                {actionErr && <span className="err">{actionErr}</span>}
            </div>

            {listError ? (
                <div className="card">
                    <p className="err">Could not load subscribers: {listError}</p>
                </div>
            ) : listLoading ? (
                <div className="card">
                    <p className="muted">Loading…</p>
                </div>
            ) : items.length === 0 ? (
                <div className="card">
                    <p className="muted">
                        No {statusFilter === "all" ? "" : statusFilter + " "}subscribers.
                    </p>
                </div>
            ) : (
                items.map((s) => (
                    <div className="card" key={s.id}>
                        <div className="head">
                            <div>
                                <b>{s.email}</b>
                                <span style={{marginLeft: 8}}>
                                    <StatusBadge status={s.status}/>
                                </span>
                                {s.confirmedAt && (
                                    <span className="muted"> · confirmed {fmtDate(s.confirmedAt)}</span>
                                )}
                                {s.unsubscribedAt && (
                                    <span className="muted"> · unsubscribed {fmtDate(s.unsubscribedAt)}</span>
                                )}
                                {!s.confirmedAt && !s.unsubscribedAt && (
                                    <span className="muted"> · signed up {fmtDate(s.createdAt)}</span>
                                )}
                            </div>
                            <button
                                className="danger"
                                onClick={() => handleRemove(s.id, s.email)}
                                disabled={busyId === s.id}
                            >
                                {busyId === s.id ? "…" : "Delete"}
                            </button>
                        </div>
                        {s.memberId && (
                            <p className="muted" style={{margin: "4px 0 0", fontSize: 12}}>
                                Member: {s.memberId}
                            </p>
                        )}
                    </div>
                ))
            )}
        </>
    );
}
