import {useState} from "react";
import {request, usePanelQuery} from "@pressh/panel-kit";

interface Comment {
    id: string;
    entrySlug: string;
    memberId: string;
    memberDisplayName: string;
    body: string;
    status: "pending" | "approved" | "rejected";
    createdAt: string;
}

interface ListAllResp {
    items: Comment[];
    total: number;
}

type StatusFilter = "pending" | "approved" | "rejected" | "all";

function fmtDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function StatusBadge({status}: { status: Comment["status"] }) {
    const colours: Record<Comment["status"], string> = {
        pending: "#d97706",
        approved: "#16a34a",
        rejected: "#dc2626",
    };
    return (
        <span style={{color: colours[status], fontWeight: 600, fontSize: 12}}>
            {status.toUpperCase()}
        </span>
    );
}

export function App() {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionErr, setActionErr] = useState<string | null>(null);

    const queryPayload = statusFilter === "all" ? {} : {status: statusFilter};
    const {data, loading, error, reload} = usePanelQuery<ListAllResp>(
        "listAll",
        queryPayload,
        [statusFilter],
    );

    async function act(action: "approve" | "reject" | "remove", id: string) {
        if (action === "remove" && !confirm("Permanently delete this comment?")) return;
        setBusyId(id);
        setActionErr(null);
        try {
            await request(action, {id});
            reload();
        } catch (e) {
            setActionErr(e instanceof Error ? e.message : String(e));
        } finally {
            setBusyId(null);
        }
    }

    const items = data?.items ?? [];
    const tabs: { label: string; value: StatusFilter }[] = [
        {label: "Pending", value: "pending"},
        {label: "Approved", value: "approved"},
        {label: "Rejected", value: "rejected"},
        {label: "All", value: "all"},
    ];

    return (
        <>
            <h2>Comments</h2>
            <p className="muted">
                New comments arrive as <strong>pending</strong> and must be approved before they appear publicly.
            </p>

            {/* Tabs */}
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
                <button onClick={reload} disabled={loading} style={{marginLeft: "auto"}}>
                    {loading ? "Loading…" : "Refresh"}
                </button>
                {actionErr && <span className="err">{actionErr}</span>}
            </div>

            {error ? (
                <div className="card">
                    <p className="err">Could not load comments: {error}</p>
                </div>
            ) : loading ? (
                <div className="card">
                    <p className="muted">Loading…</p>
                </div>
            ) : items.length === 0 ? (
                <div className="card">
                    <p className="muted">
                        No {statusFilter === "all" ? "" : statusFilter + " "}comments.
                    </p>
                </div>
            ) : (
                items.map((c) => (
                    <div className="card" key={c.id}>
                        <div className="head">
                            <div>
                                <b>{c.memberDisplayName}</b>
                                <span className="muted"> on </span>
                                <code style={{fontSize: 12}}>{c.entrySlug}</code>
                                <span className="muted"> · {fmtDate(c.createdAt)}</span>
                                <span style={{marginLeft: 8}}>
                                    <StatusBadge status={c.status}/>
                                </span>
                            </div>
                            <div className="row" style={{gap: 6}}>
                                {c.status !== "approved" && (
                                    <button
                                        onClick={() => act("approve", c.id)}
                                        disabled={busyId === c.id}
                                        style={{color: "#16a34a"}}
                                    >
                                        {busyId === c.id ? "…" : "Approve"}
                                    </button>
                                )}
                                {c.status !== "rejected" && (
                                    <button
                                        onClick={() => act("reject", c.id)}
                                        disabled={busyId === c.id}
                                    >
                                        {busyId === c.id ? "…" : "Reject"}
                                    </button>
                                )}
                                <button
                                    className="danger"
                                    onClick={() => act("remove", c.id)}
                                    disabled={busyId === c.id}
                                >
                                    {busyId === c.id ? "…" : "Delete"}
                                </button>
                            </div>
                        </div>
                        <p style={{margin: "6px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word"}}>
                            {c.body}
                        </p>
                    </div>
                ))
            )}
        </>
    );
}
