import {createContext, useContext} from "react";
import type {Category, Settings} from "./types";
import {moneyWith} from "./format";

export interface Store {
    settings: Settings | null;
    categories: Category[];
    /** Formats an amount using the active currency symbol. */
    money: (n: unknown) => string;
    /** Looks up a category name by id (— for none). */
    catName: (id: string | null | undefined) => string;
    /** Re-fetches categories (after an edit) so all tabs stay in sync. */
    reloadCategories: () => Promise<void>;
    /** Re-fetches settings (after Settings save). */
    reloadSettings: () => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export const StoreProvider = StoreContext.Provider;

export function useStore(): Store {
    const s = useContext(StoreContext);
    if (!s) throw new Error("useStore must be used within StoreProvider");
    return s;
}

export function makeMoney(settings: Settings | null): (n: unknown) => string {
    const symbol = (settings && settings.currencySymbol) || "$";
    return (n: unknown) => moneyWith(symbol, n);
}

export function makeCatName(categories: Category[]): (id: string | null | undefined) => string {
    return (id) => {
        if (!id) return "";
        const c = categories.find((x) => x.id === id);
        return c ? c.name : "—";
    };
}
