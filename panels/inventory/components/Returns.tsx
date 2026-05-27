import {useEffect, useState} from "react";
import {api} from "../api";
import {useStore} from "../context";
import {fmtDate} from "../format";
import {Empty, ErrorText, Loading, StatusBadge} from "../ui";
import type {ReturnRecord} from "../types";

export function Returns() {
    const {money} = useStore();
    const [status, setStatus] = useState("");
    const [returns, setReturns] = useState<ReturnRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        try {
            const r = await api.listReturns(status);
            setReturns(r.returns);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void load();
    }, [status]);

    async function process(id: string) {
        if (
            !confirm(
                "Process this return? This will restock items (if requested) and issue a refund up to the amount paid.",
            )
        )
            return;
        try {
            await api.processReturn(id);
            await load();
        } catch (e) {
            alert(e instanceof Error ? e.message : String(e));
        }
    }

    async function reject(id: string) {
        try {
            await api.updateReturnStatus(id, "rejected");
            await load();
        } catch (e) {
            alert(e instanceof Error ? e.message : String(e));
        }
    }

    return (
        <section>
            <div className="row" style={{marginBottom: 12}}>
                <select style={{maxWidth: 200}} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="requested">Requested</option>
                    <option value="approved">Approved</option>
                    <option value="received">Received</option>
                    <option value="refunded">Refunded</option>
                    <option value="rejected">Rejected</option>
                </select>
            </div>

            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorText>{error}</ErrorText>
            ) : !returns.length ? (
                <Empty>No returns found.</Empty>
            ) : (
                <table>
                    <thead>
                    <tr>
                        <th>Return</th>
                        <th>Order</th>
                        <th>Date</th>
                        <th className="num">Items</th>
                        <th className="num">Refund</th>
                        <th>Status</th>
                        <th></th>
                    </tr>
                    </thead>
                    <tbody>
                    {returns.map((rt) => {
                        const itemCount = (rt.lines || []).reduce((s, l) => s + l.qty, 0);
                        const canProcess = rt.status !== "refunded" && rt.status !== "rejected";
                        return (
                            <tr key={rt.id}>
                                <td>
                                    <b>#{rt.number}</b>
                                </td>
                                <td>#{rt.orderNumber}</td>
                                <td className="muted">{fmtDate(rt.createdAt)}</td>
                                <td className="num">{itemCount}</td>
                                <td className="num">{money(rt.refundAmount)}</td>
                                <td>
                                    <StatusBadge status={rt.status}/>
                                </td>
                                <td className="right">
                                    {canProcess && (
                                        <button className="btn mini" onClick={() => process(rt.id)}>
                                            Process
                                        </button>
                                    )}{" "}
                                    {rt.status === "requested" && (
                                        <button className="btn mini danger" onClick={() => reject(rt.id)}>
                                            Reject
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                    </tbody>
                </table>
            )}
        </section>
    );
}
