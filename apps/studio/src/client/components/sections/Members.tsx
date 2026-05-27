import {useMemo, useState} from "react";
import {api} from "../../api";
import {ConfirmModal, ErrorCard, fmtDate, Loading, RowHead, useLoader, useToast} from "../ui";

interface MemberRow {
    id: string;
    email: string;
    displayName: string;
    status: "active" | "suspended";
    emailVerified: boolean;
    createdAt: string;
}

export function Members() {
    const toast = useToast();
    const {data, loading, error, reload} = useLoader(async () => {
        const r = await api<{ data?: { items?: MemberRow[] } }>("/admin/api/members");
        return r.body.data?.items ?? [];
    });
    const [search, setSearch] = useState("");
    const [eraseTarget, setEraseTarget] = useState<MemberRow | null>(null);

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = data ?? [];
        if (!q) return list;
        return list.filter((m) => m.email.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q));
    }, [data, search]);

    async function setStatus(m: MemberRow, status: "active" | "suspended") {
        const action = status === "suspended" ? "suspend" : "activate";
        const r = await api(`/admin/api/members/${m.id}/${action}`, {method: "POST"});
        if (r.status === 200) {
            toast(status === "suspended" ? "Member suspended" : "Member reactivated");
            reload();
        } else {
            toast("Update failed", true);
        }
    }

    async function exportData(m: MemberRow) {
        const r = await api<{ data?: unknown }>(`/admin/api/members/${m.id}/export`);
        if (r.status !== 200 || !r.body.data) return toast("Export failed", true);
        const blob = new Blob([JSON.stringify(r.body.data, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `member-${m.email}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast("Export downloaded");
    }

    async function erase(m: MemberRow) {
        setEraseTarget(null);
        const r = await api(`/admin/api/members/${m.id}/erase`, {method: "POST"});
        if (r.status === 200) {
            toast("Member erased");
            reload();
        } else {
            toast("Erase failed", true);
        }
    }

    return (
        <>
            <RowHead title="Members">
                <input
                    type="search"
                    placeholder="Search email or name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{maxWidth: "16rem"}}
                />
            </RowHead>

            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorCard message={error}/>
            ) : (
                <div className="card">
                    {!rows.length ? (
                        <div className="empty">
                            {data && data.length ? "No members match your search." : "No site members yet."}
                        </div>
                    ) : (
                        <table className="tbl">
                            <thead>
                            <tr>
                                <th>Email</th>
                                <th>Name</th>
                                <th>Status</th>
                                <th>Joined</th>
                                <th></th>
                            </tr>
                            </thead>
                            <tbody>
                            {rows.map((m) => (
                                <tr key={m.id}>
                                    <td>
                                        <b>{m.email}</b>
                                        {!m.emailVerified && (
                                            <span className="tag" title="Email not verified"> unverified</span>
                                        )}
                                    </td>
                                    <td>{m.displayName}</td>
                                    <td>
                                        <span className={"badge b-" + (m.status === "active" ? "active" : "disabled")}>
                                            {m.status}
                                        </span>
                                    </td>
                                    <td className="meta">{fmtDate(m.createdAt)}</td>
                                    <td className="actions">
                                        {m.status === "active" ? (
                                            <button className="iconbtn danger"
                                                    onClick={() => setStatus(m, "suspended")}>
                                                Suspend
                                            </button>
                                        ) : (
                                            <button className="iconbtn" onClick={() => setStatus(m, "active")}>
                                                Reactivate
                                            </button>
                                        )}
                                        <button className="iconbtn" title="Download their data (GDPR export)"
                                                onClick={() => exportData(m)}>
                                            Export
                                        </button>
                                        <button className="iconbtn danger" title="Erase member and all their data"
                                                onClick={() => setEraseTarget(m)}>
                                            Erase
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {eraseTarget && (
                <ConfirmModal
                    title={`Erase ${eraseTarget.email}?`}
                    message="This permanently deletes the account and erases all their submitted data (form submissions, orders). This is the GDPR right-to-be-forgotten and cannot be undone."
                    confirmLabel="Erase everything"
                    onConfirm={() => erase(eraseTarget)}
                    onCancel={() => setEraseTarget(null)}
                />
            )}
        </>
    );
}
