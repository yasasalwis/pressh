import {useEffect, useState} from "react";
import {api} from "../api";
import {useStore} from "../context";
import {fmtDate} from "../format";
import {Empty, ErrorText, Loading, PayBadge, StatusBadge} from "../ui";
import type {Order} from "../types";
import {OrderDetail} from "./OrderDetail";

export function Orders() {
    const {money} = useStore();
    const [status, setStatus] = useState("");
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Debounce the search box (250ms) like the original panel.
    useEffect(() => {
        const t = setTimeout(() => setQuery(search), 250);
        return () => clearTimeout(t);
    }, [search]);

    async function load() {
        setLoading(true);
        try {
            const r = await api.listOrders({status, search: query});
            setOrders(r.orders);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!selectedId) void load();
    }, [status, query, selectedId]);

    if (selectedId) {
        return (
            <OrderDetail
                id={selectedId}
                onBack={() => {
                    setSelectedId(null);
                }}
            />
        );
    }

    return (
        <section>
            <div className="row" style={{marginBottom: 12, gap: 8}}>
                <select style={{maxWidth: 180}} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="fulfilled">Fulfilled</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="refunded">Refunded</option>
                </select>
                <input
                    style={{maxWidth: 260}}
                    placeholder="Search order # or customer"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {loading ? (
                <Loading/>
            ) : error ? (
                <ErrorText>{error}</ErrorText>
            ) : !orders.length ? (
                <Empty>No orders found.</Empty>
            ) : (
                <table>
                    <thead>
                    <tr>
                        <th>Order</th>
                        <th>Customer</th>
                        <th>Date</th>
                        <th className="num">Total</th>
                        <th>Status</th>
                        <th>Payment</th>
                        <th></th>
                    </tr>
                    </thead>
                    <tbody>
                    {orders.map((o) => (
                        <tr key={o.id}>
                            <td>
                                <b>#{o.number}</b>
                            </td>
                            <td>{(o.customer && (o.customer.name || o.customer.email)) || "—"}</td>
                            <td className="muted">{fmtDate(o.createdAt)}</td>
                            <td className="num">{money(o.total)}</td>
                            <td>
                                <StatusBadge status={o.status}/>
                            </td>
                            <td>
                                <PayBadge status={o.paymentStatus}/>
                            </td>
                            <td className="right">
                                <button className="btn mini" onClick={() => setSelectedId(o.id)}>
                                    View
                                </button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}
