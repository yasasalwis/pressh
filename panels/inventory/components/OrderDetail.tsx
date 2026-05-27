import {useCallback, useEffect, useState} from "react";
import {api} from "../api";
import {useStore} from "../context";
import {ErrorText, Loading, Msg, PayBadge, StatusBadge} from "../ui";
import type {Order, Payment, ReturnRecord} from "../types";

const ORDER_STATUSES = ["pending", "paid", "fulfilled", "cancelled", "refunded"];
const METHODS = ["card", "cash", "bank", "manual", "other"];

export function OrderDetail({id, onBack}: { id: string; onBack: () => void }) {
    const {money} = useStore();
    const [order, setOrder] = useState<Order | null>(null);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [returns, setReturns] = useState<ReturnRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [msg, setMsg] = useState<{ text: string; kind?: "ok" | "err" } | null>(null);

    const [statusSel, setStatusSel] = useState("pending");
    const [payAmount, setPayAmount] = useState("0");
    const [payMethod, setPayMethod] = useState("card");
    const [refAmount, setRefAmount] = useState("0");
    const [refMethod, setRefMethod] = useState("card");
    const [retQty, setRetQty] = useState<Record<number, string>>({});
    const [retReason, setRetReason] = useState("");
    const [retRestock, setRetRestock] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.getOrder(id);
            setOrder(r.order);
            setPayments(r.payments);
            setReturns(r.returns);
            setStatusSel(r.order.status);
            const balance =
                (Number(r.order.total) || 0) - ((Number(r.order.amountPaid) || 0) - (Number(r.order.amountRefunded) || 0));
            setPayAmount(balance > 0 ? balance.toFixed(2) : "0");
            setRefAmount("0");
            setRetQty({});
            setRetReason("");
            setRetRestock(true);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        void load();
    }, [load]);

    async function run(fn: () => Promise<unknown>) {
        try {
            await fn();
            await load();
        } catch (e) {
            setMsg({text: e instanceof Error ? e.message : String(e), kind: "err"});
        }
    }

    if (loading) return <Loading/>;
    if (error) return <ErrorText>{error}</ErrorText>;
    if (!order) return null;

    const balance =
        (Number(order.total) || 0) - ((Number(order.amountPaid) || 0) - (Number(order.amountRefunded) || 0));

    function createReturn() {
        const lines: { itemId: string; variantId: string; qty: number }[] = [];
        (order!.lines || []).forEach((l, i) => {
            const qty = parseInt(retQty[i] ?? "", 10) || 0;
            if (qty > 0) lines.push({itemId: l.itemId, variantId: l.variantId, qty});
        });
        if (!lines.length) {
            setMsg({text: "Set a return quantity for at least one item.", kind: "err"});
            return;
        }
        void run(() => api.createReturn({orderId: order!.id, lines, reason: retReason, restock: retRestock}));
    }

    return (
        <section>
            <div className="row between" style={{marginBottom: 12}}>
                <strong>
                    Order #{order.number} &nbsp;
                    <StatusBadge status={order.status}/> <PayBadge status={order.paymentStatus}/>
                </strong>
                <button className="btn" onClick={onBack}>
                    ← Back to orders
                </button>
            </div>

            <div className="grid g2">
                <div className="card">
                    <strong>Items</strong>
                    <table style={{marginTop: 8}}>
                        <thead>
                        <tr>
                            <th>Product</th>
                            <th className="num">Qty</th>
                            <th className="num">Unit</th>
                            <th className="num">Total</th>
                        </tr>
                        </thead>
                        <tbody>
                        {(order.lines || []).map((l, i) => (
                            <tr key={i}>
                                <td>
                                    {l.name}
                                    <br/>
                                    <span className="muted">{l.variantLabel || ""}</span>
                                </td>
                                <td className="num">{l.qty}</td>
                                <td className="num">{money(l.unitPrice)}</td>
                                <td className="num">{money(l.lineTotal)}</td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                    <table style={{marginTop: 8}}>
                        <tbody>
                        <tr>
                            <td>Subtotal</td>
                            <td className="num">{money(order.subtotal)}</td>
                        </tr>
                        <tr>
                            <td>Tax</td>
                            <td className="num">{money(order.tax)}</td>
                        </tr>
                        <tr>
                            <td>Shipping</td>
                            <td className="num">{money(order.shipping)}</td>
                        </tr>
                        {order.discount ? (
                            <tr>
                                <td>Discount</td>
                                <td className="num">−{money(order.discount)}</td>
                            </tr>
                        ) : null}
                        <tr>
                            <td>
                                <b>Total</b>
                            </td>
                            <td className="num">
                                <b>{money(order.total)}</b>
                            </td>
                        </tr>
                        <tr>
                            <td>Paid</td>
                            <td className="num ok">{money(order.amountPaid)}</td>
                        </tr>
                        {order.amountRefunded ? (
                            <tr>
                                <td>Refunded</td>
                                <td className="num err">{money(order.amountRefunded)}</td>
                            </tr>
                        ) : null}
                        <tr>
                            <td>Balance due</td>
                            <td className="num">{money(balance)}</td>
                        </tr>
                        </tbody>
                    </table>
                </div>

                <div className="card">
                    <strong>Customer</strong>
                    <div style={{marginTop: 6}}>
                        <div>{(order.customer && order.customer.name) || "—"}</div>
                        <div className="muted">{(order.customer && order.customer.email) || ""}</div>
                        <div className="muted">{(order.customer && order.customer.phone) || ""}</div>
                        <div className="muted" style={{whiteSpace: "pre-wrap"}}>
                            {(order.customer && order.customer.address) || ""}
                        </div>
                        {order.note && (
                            <div style={{marginTop: 8}}>
                                <span className="muted">Note:</span> {order.note}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="card">
                <strong>Update status</strong>
                <div className="row" style={{marginTop: 8}}>
                    <select style={{maxWidth: 200}} value={statusSel} onChange={(e) => setStatusSel(e.target.value)}>
                        {ORDER_STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                    <button
                        className="btn primary"
                        onClick={() => run(() => api.updateOrderStatus(order.id, statusSel))}
                    >
                        Apply
                    </button>
                    {msg && <Msg text={msg.text} kind={msg.kind}/>}
                </div>
            </div>

            <div className="grid g2">
                <div className="card">
                    <strong>Record payment</strong>
                    <div className="grid g2" style={{marginTop: 8}}>
                        <div>
                            <label>Amount</label>
                            <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={payAmount}
                                onChange={(e) => setPayAmount(e.target.value)}
                            />
                        </div>
                        <div>
                            <label>Method</label>
                            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                                {METHODS.map((m) => (
                                    <option key={m}>{m}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <button
                        className="btn primary"
                        style={{marginTop: 10}}
                        onClick={() =>
                            run(() => api.recordPayment({
                                orderId: order.id,
                                amount: parseFloat(payAmount),
                                method: payMethod
                            }))
                        }
                    >
                        Record payment
                    </button>
                </div>

                <div className="card">
                    <strong>Refund</strong>
                    <div className="grid g2" style={{marginTop: 8}}>
                        <div>
                            <label>Amount</label>
                            <input
                                type="number"
                                min={0}
                                step={0.01}
                                value={refAmount}
                                onChange={(e) => setRefAmount(e.target.value)}
                            />
                        </div>
                        <div>
                            <label>Method</label>
                            <select value={refMethod} onChange={(e) => setRefMethod(e.target.value)}>
                                {METHODS.map((m) => (
                                    <option key={m}>{m}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <button
                        className="btn"
                        style={{marginTop: 10}}
                        onClick={() =>
                            run(() => api.refundPayment({
                                orderId: order.id,
                                amount: parseFloat(refAmount),
                                method: refMethod
                            }))
                        }
                    >
                        Issue refund
                    </button>
                </div>
            </div>

            <div className="card">
                <strong>Payments</strong>
                <table style={{marginTop: 8}}>
                    <thead>
                    <tr>
                        <th>When</th>
                        <th>Type</th>
                        <th className="num">Amount</th>
                        <th>Method</th>
                    </tr>
                    </thead>
                    <tbody>
                    {payments.length ? (
                        payments.map((p) => (
                            <tr key={p.id}>
                                <td>{new Date(p.at).toLocaleString()}</td>
                                <td>{p.kind}</td>
                                <td className={"num " + (p.kind === "refund" ? "err" : "ok")}>
                                    {(p.kind === "refund" ? "−" : "") + money(p.amount)}
                                </td>
                                <td>{p.method}</td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={4} className="muted">
                                No payments recorded.
                            </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>

            <div className="card">
                <strong>Create return</strong>
                <table style={{marginTop: 8}}>
                    <thead>
                    <tr>
                        <th>Product</th>
                        <th></th>
                        <th>Return qty</th>
                    </tr>
                    </thead>
                    <tbody>
                    {(order.lines || []).map((l, i) => (
                        <tr key={i}>
                            <td>
                                {l.name} <span className="muted">{l.variantLabel || ""}</span>
                            </td>
                            <td className="muted">ordered {l.qty}</td>
                            <td>
                                <input
                                    type="number"
                                    min={0}
                                    max={l.qty}
                                    style={{width: 70}}
                                    value={retQty[i] ?? "0"}
                                    onChange={(e) => setRetQty((prev) => ({...prev, [i]: e.target.value}))}
                                />
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
                <label>Reason</label>
                <input
                    placeholder="e.g. damaged on arrival"
                    value={retReason}
                    onChange={(e) => setRetReason(e.target.value)}
                />
                <label className="row" style={{marginTop: 8}}>
                    <input type="checkbox" checked={retRestock} onChange={(e) => setRetRestock(e.target.checked)}/>
                    &nbsp;Restock returned items
                </label>
                <button className="btn primary" style={{marginTop: 10}} onClick={createReturn}>
                    Create return
                </button>
            </div>

            <div className="card">
                <strong>Returns for this order</strong>
                <table style={{marginTop: 8}}>
                    <thead>
                    <tr>
                        <th>Return</th>
                        <th className="num">Refund</th>
                        <th>Status</th>
                    </tr>
                    </thead>
                    <tbody>
                    {returns.length ? (
                        returns.map((r) => (
                            <tr key={r.id}>
                                <td>#{r.number}</td>
                                <td className="num">{money(r.refundAmount)}</td>
                                <td>
                                    <StatusBadge status={r.status}/>
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={3} className="muted">
                                No returns.
                            </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
