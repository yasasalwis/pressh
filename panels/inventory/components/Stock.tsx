import {useEffect, useMemo, useState} from "react";
import {api} from "../api";
import {useStore} from "../context";
import {fmtDate} from "../format";
import {ErrorText, Loading, Msg} from "../ui";
import type {Movement, Product} from "../types";

export function Stock() {
    const {settings} = useStore();
    const [items, setItems] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadErr, setLoadErr] = useState<string | null>(null);
    const [productId, setProductId] = useState("");
    const [variantId, setVariantId] = useState("");
    const [mode, setMode] = useState<"receive" | "remove" | "set">("receive");
    const [amount, setAmount] = useState("0");
    const [reason, setReason] = useState("");
    const [msg, setMsg] = useState<{ text: string; kind?: "ok" | "err" } | null>(null);
    const [busy, setBusy] = useState(false);

    const [movements, setMovements] = useState<Movement[]>([]);
    const [movLoading, setMovLoading] = useState(false);

    async function loadItems() {
        setLoading(true);
        try {
            const r = await api.listItems();
            setItems(r.items);
            setLoadErr(null);
        } catch (e) {
            setLoadErr(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadItems();
    }, []);

    const product = useMemo(() => items.find((p) => p.id === productId) ?? null, [items, productId]);

    useEffect(() => {
        // keep variant selection valid for the chosen product
        if (product && product.variants.length) {
            if (!product.variants.some((v) => v.id === variantId)) setVariantId(product.variants[0]!.id);
        } else {
            setVariantId("");
        }
    }, [product, variantId]);

    async function loadMovements(id: string) {
        if (!id) {
            setMovements([]);
            return;
        }
        setMovLoading(true);
        try {
            const r = await api.listMovements(id);
            setMovements(r.movements);
        } catch {
            setMovements([]);
        } finally {
            setMovLoading(false);
        }
    }

    useEffect(() => {
        void loadMovements(productId);
    }, [productId]);

    const defThreshold = (settings && settings.lowStockThreshold) || 0;

    function variantName(vid: string): string {
        const v = product?.variants.find((x) => x.id === vid);
        return v ? v.label || "Default" : vid;
    }

    async function apply() {
        const amt = parseInt(amount, 10);
        if (!productId || !Number.isInteger(amt)) {
            setMsg({text: "Enter a whole number amount.", kind: "err"});
            return;
        }
        const payload =
            mode === "set"
                ? {mode: "set" as const, amount: amt, type: "correction"}
                : mode === "remove"
                    ? {mode: "delta" as const, amount: -Math.abs(amt), type: "adjust"}
                    : {mode: "delta" as const, amount: Math.abs(amt), type: "receive"};
        setBusy(true);
        try {
            const r = await api.adjustStock({itemId: productId, variantId, reason, ...payload});
            setItems((prev) => prev.map((p) => (p.id === productId ? r.item : p)));
            setAmount("0");
            setReason("");
            setMsg({text: "Stock updated.", kind: "ok"});
            await loadMovements(productId);
        } catch (e) {
            setMsg({text: e instanceof Error ? e.message : String(e), kind: "err"});
        } finally {
            setBusy(false);
        }
    }

    if (loading) return <Loading/>;
    if (loadErr) return <ErrorText>{loadErr}</ErrorText>;

    return (
        <section>
            <div className="card">
                <label>Product</label>
                <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                    <option value="">— Select a product —</option>
                    {items.map((it) => (
                        <option key={it.id} value={it.id}>
                            {it.name}
                        </option>
                    ))}
                </select>

                {product && (
                    <div style={{marginTop: 12}}>
                        <table>
                            <thead>
                            <tr>
                                <th>Variant</th>
                                <th>SKU</th>
                                <th className="num">On hand</th>
                            </tr>
                            </thead>
                            <tbody>
                            {product.variants.map((v) => {
                                const thr = v.lowStockThreshold ?? product.lowStockThreshold ?? defThreshold;
                                const low = (Number(v.stock) || 0) <= Number(thr);
                                return (
                                    <tr key={v.id}>
                                        <td>
                                            <b>{v.label || "Default"}</b>
                                        </td>
                                        <td className="muted">{v.sku || ""}</td>
                                        <td className="num">
                                            {Number(v.stock) || 0}
                                            {low && <span className="tag low"> Low</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {product && (
                <div className="card">
                    <strong>Adjust stock</strong>
                    <div className="grid g4" style={{marginTop: 8}}>
                        <div>
                            <label>Variant</label>
                            <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                                {product.variants.map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.label || "Default"}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label>Action</label>
                            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                                <option value="receive">Receive (+)</option>
                                <option value="remove">Remove (−)</option>
                                <option value="set">Set exact level</option>
                            </select>
                        </div>
                        <div>
                            <label>Amount</label>
                            <input type="number" min={0} step={1} value={amount}
                                   onChange={(e) => setAmount(e.target.value)}/>
                        </div>
                        <div>
                            <label>Reason</label>
                            <input placeholder="e.g. restock" value={reason}
                                   onChange={(e) => setReason(e.target.value)}/>
                        </div>
                    </div>
                    <div className="row" style={{marginTop: 12}}>
                        <button className="btn primary" onClick={apply} disabled={busy}>
                            Apply adjustment
                        </button>
                        {msg && <Msg text={msg.text} kind={msg.kind}/>}
                    </div>
                </div>
            )}

            <div className="card">
                <strong>Stock movements</strong>
                <div style={{marginTop: 8}}>
                    {!productId ? (
                        <p className="muted">Select a product to see its ledger.</p>
                    ) : movLoading ? (
                        <Loading/>
                    ) : !movements.length ? (
                        <p className="muted">No movements recorded yet.</p>
                    ) : (
                        <table>
                            <thead>
                            <tr>
                                <th>When</th>
                                <th>Variant</th>
                                <th>Type</th>
                                <th className="num">Change</th>
                                <th className="num">Balance</th>
                                <th>Reason</th>
                            </tr>
                            </thead>
                            <tbody>
                            {movements.map((m) => (
                                <tr key={m.id}>
                                    <td>{fmtDate(m.at)}</td>
                                    <td>{variantName(m.variantId)}</td>
                                    <td>{m.type}</td>
                                    <td className={"num " + (m.qtyDelta >= 0 ? "ok" : "err")}>
                                        {(m.qtyDelta > 0 ? "+" : "") + m.qtyDelta}
                                    </td>
                                    <td className="num">{m.balanceAfter}</td>
                                    <td className="muted">{m.reason || ""}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </section>
    );
}
