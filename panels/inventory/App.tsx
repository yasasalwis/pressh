import {useCallback, useEffect, useMemo, useState} from "react";
import {api} from "./api";
import {makeCatName, makeMoney, type Store, StoreProvider} from "./context";
import type {Category, Settings} from "./types";
import {Dashboard} from "./components/Dashboard";
import {Products} from "./components/Products";
import {Categories} from "./components/Categories";
import {Stock} from "./components/Stock";
import {Orders} from "./components/Orders";
import {Returns} from "./components/Returns";
import {Payments} from "./components/Payments";
import {SettingsTab} from "./components/SettingsTab";

const TABS = [
    ["dashboard", "Dashboard"],
    ["products", "Products"],
    ["categories", "Categories"],
    ["stock", "Stock"],
    ["orders", "Orders"],
    ["returns", "Returns"],
    ["payments", "Payments"],
    ["settings", "Settings"],
] as const;

type TabId = (typeof TABS)[number][0];

export function App() {
    const [tab, setTab] = useState<TabId>("dashboard");
    const [settings, setSettings] = useState<Settings | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);

    const reloadSettings = useCallback(async () => {
        const r = await api.getSettings().catch(() => null);
        if (r) setSettings(r.settings);
    }, []);

    const reloadCategories = useCallback(async () => {
        const r = await api.listCategories().catch(() => null);
        setCategories((r && r.categories) || []);
    }, []);

    useEffect(() => {
        void reloadSettings();
        void reloadCategories();
    }, [reloadSettings, reloadCategories]);

    const store = useMemo<Store>(
        () => ({
            settings,
            categories,
            money: makeMoney(settings),
            catName: makeCatName(categories),
            reloadCategories,
            reloadSettings,
        }),
        [settings, categories, reloadCategories, reloadSettings],
    );

    return (
        <StoreProvider value={store}>
            <div className="wrap">
                <h2>Inventory &amp; Store</h2>
                <p className="sub">Manage your product catalog, variants, categories, stock and store settings.</p>

                <div className="tabs">
                    {TABS.map(([id, label]) => (
                        <button
                            key={id}
                            className={"tab" + (tab === id ? " active" : "")}
                            onClick={() => setTab(id)}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {tab === "dashboard" && <Dashboard/>}
                {tab === "products" && <Products/>}
                {tab === "categories" && <Categories/>}
                {tab === "stock" && <Stock/>}
                {tab === "orders" && <Orders/>}
                {tab === "returns" && <Returns/>}
                {tab === "payments" && <Payments/>}
                {tab === "settings" && <SettingsTab/>}
            </div>
        </StoreProvider>
    );
}
