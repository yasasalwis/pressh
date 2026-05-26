import {useEffect, useState} from "react";
import {api} from "../api";
import {useStore} from "../context";
import {Msg} from "../ui";

export function SettingsTab() {
    const {settings, reloadSettings} = useStore();
    const [storeName, setStoreName] = useState("");
    const [currency, setCurrency] = useState("USD");
    const [currencySymbol, setCurrencySymbol] = useState("$");
    const [taxRate, setTaxRate] = useState("0");
    const [shippingFlat, setShippingFlat] = useState("0");
    const [lowStockThreshold, setLowStockThreshold] = useState("5");
    const [msg, setMsg] = useState<{ text: string; kind?: "ok" | "err" } | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!settings) return;
        setStoreName(settings.storeName || "");
        setCurrency(settings.currency || "USD");
        setCurrencySymbol(settings.currencySymbol || "$");
        setTaxRate(String(settings.taxRate ?? 0));
        setShippingFlat(String(settings.shippingFlat ?? 0));
        setLowStockThreshold(String(settings.lowStockThreshold ?? 5));
    }, [settings]);

    async function save() {
        setSaving(true);
        setMsg({text: "Saving…"});
        try {
            await api.saveSettings({
                storeName,
                currency,
                currencySymbol,
                taxRate: parseFloat(taxRate) || 0,
                shippingFlat: parseFloat(shippingFlat) || 0,
                lowStockThreshold: parseInt(lowStockThreshold, 10) || 0,
            });
            await reloadSettings();
            setMsg({text: "Saved.", kind: "ok"});
        } catch (e) {
            setMsg({text: e instanceof Error ? e.message : String(e), kind: "err"});
        } finally {
            setSaving(false);
        }
    }

    return (
        <section>
            <div className="card">
                <strong>Store settings</strong>
                <div className="grid g2" style={{marginTop: 8}}>
                    <div>
                        <label>Store name</label>
                        <input value={storeName} onChange={(e) => setStoreName(e.target.value)}/>
                    </div>
                    <div>
                        <label>Default low-stock alert</label>
                        <input
                            type="number"
                            min={0}
                            step={1}
                            value={lowStockThreshold}
                            onChange={(e) => setLowStockThreshold(e.target.value)}
                        />
                    </div>
                </div>
                <div className="grid g4">
                    <div>
                        <label>Currency code</label>
                        <input maxLength={8} value={currency} onChange={(e) => setCurrency(e.target.value)}/>
                    </div>
                    <div>
                        <label>Currency symbol</label>
                        <input
                            maxLength={4}
                            value={currencySymbol}
                            onChange={(e) => setCurrencySymbol(e.target.value)}
                        />
                    </div>
                    <div>
                        <label>Tax rate (%)</label>
                        <input
                            type="number"
                            max={100}
                            min={0}
                            step={0.01}
                            value={taxRate}
                            onChange={(e) => setTaxRate(e.target.value)}
                        />
                    </div>
                    <div>
                        <label>Flat shipping</label>
                        <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={shippingFlat}
                            onChange={(e) => setShippingFlat(e.target.value)}
                        />
                    </div>
                </div>
                <div className="row" style={{marginTop: 12}}>
                    <button className="btn primary" onClick={save} disabled={saving}>
                        Save settings
                    </button>
                    {msg && <Msg text={msg.text} kind={msg.kind}/>}
                </div>
            </div>
        </section>
    );
}
