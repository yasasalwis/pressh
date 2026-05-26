import {usePanelQuery} from "../../shared/usePanelQuery";
import type {DashboardSummary} from "../types";
import {useStore} from "../context";
import {ErrorText, Loading, PayBadge, StatCard, StatusBadge} from "../ui";

export function Dashboard() {
    const {money} = useStore();
    const {data, loading, error} = usePanelQuery<DashboardSummary>("summary");

    if (loading) return <Loading/>;
    if (error) return <ErrorText>{error}</ErrorText>;
    if (!data) return null;

    const byStatus = Object.keys(data.ordersByStatus || {});

    return (
        <section>
            <div className="grid g4" style={{marginBottom: 16}}>
                <StatCard label="Revenue (net)" value={money(data.revenue)}/>
                <StatCard label="Outstanding" value={money(data.outstanding)}/>
                <StatCard label="Orders" value={data.counts.orders}/>
                <StatCard label="Low stock" value={data.counts.lowStock}/>
            </div>

            <div className="card">
                <strong>Orders by status</strong>
                <div style={{marginTop: 8}}>
                    {byStatus.length ? (
                        byStatus.map((k) => (
                            <span key={k} className="pill">
                {k}: {data.ordersByStatus[k]}
              </span>
                        ))
                    ) : (
                        <span className="muted">No orders yet.</span>
                    )}
                </div>
            </div>

            <div className="card">
                <strong>Recent orders</strong>
                <div style={{marginTop: 8}}>
                    {data.recentOrders.length ? (
                        <table>
                            <thead>
                            <tr>
                                <th>Order</th>
                                <th>Customer</th>
                                <th className="num">Total</th>
                                <th>Status</th>
                                <th>Payment</th>
                            </tr>
                            </thead>
                            <tbody>
                            {data.recentOrders.map((o) => (
                                <tr key={o.id}>
                                    <td>
                                        <b>#{o.number}</b>
                                    </td>
                                    <td>{o.customer}</td>
                                    <td className="num">{money(o.total)}</td>
                                    <td>
                                        <StatusBadge status={o.status}/>
                                    </td>
                                    <td>
                                        <PayBadge status={o.paymentStatus}/>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    ) : (
                        <p className="muted">No orders yet.</p>
                    )}
                </div>
            </div>

            <div className="card">
                <strong>Low stock</strong>
                <div style={{marginTop: 8}}>
                    {data.lowStockProducts.length ? (
                        data.lowStockProducts.map((p) => (
                            <div
                                key={p.id}
                                className="row between"
                                style={{borderBottom: "1px solid var(--bd)", padding: "6px 0"}}
                            >
                                <span>{p.name}</span>
                                <span className="tag low">{p.totalStock} left</span>
                            </div>
                        ))
                    ) : (
                        <p className="muted">All products are well stocked.</p>
                    )}
                </div>
            </div>
        </section>
    );
}
