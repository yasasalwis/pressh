import {usePanelQuery} from "../../shared/usePanelQuery";
import type {Payment} from "../types";
import {useStore} from "../context";
import {fmtDate} from "../format";
import {Empty, ErrorText, Loading} from "../ui";

export function Payments() {
    const {money} = useStore();
    const {data, loading, error} = usePanelQuery<{ payments: Payment[] }>("listPayments");

    if (loading) return <Loading/>;
    if (error) return <ErrorText>{error}</ErrorText>;
    const payments = data?.payments ?? [];

    return (
        <section>
            <p className="sub">Every payment and refund recorded against an order.</p>
            {payments.length ? (
                <table>
                    <thead>
                    <tr>
                        <th>When</th>
                        <th>Order</th>
                        <th>Type</th>
                        <th className="num">Amount</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th>Note</th>
                    </tr>
                    </thead>
                    <tbody>
                    {payments.map((p) => (
                        <tr key={p.id}>
                            <td>{fmtDate(p.at)}</td>
                            <td>#{p.orderNumber}</td>
                            <td>{p.kind}</td>
                            <td className={"num " + (p.kind === "refund" ? "err" : "ok")}>
                                {(p.kind === "refund" ? "−" : "") + money(p.amount)}
                            </td>
                            <td>{p.method}</td>
                            <td>{p.status}</td>
                            <td className="muted">{p.note || ""}</td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            ) : (
                <Empty>No payments recorded yet.</Empty>
            )}
        </section>
    );
}
