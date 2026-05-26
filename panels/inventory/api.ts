import {request} from "@pressh/panel-kit";
import type {Category, DashboardSummary, Movement, Order, Payment, Product, ReturnRecord, Settings,} from "./types";

// Payload shapes sent to the host (the plugin normalises/validates server-side).
export interface VariantInput {
    id?: string;
    optionValues: Record<string, string>;
    sku: string;
    price?: number;
    stock?: number;
    lowStockThreshold?: number;
}

export interface ProductInput {
    id?: string;
    name: string;
    slug: string;
    sku: string;
    price: number;
    compareAtPrice?: number;
    currency: string;
    categoryId: string | null;
    description: string;
    tags: string[];
    images: string[];
    options: { name: string; values: string[] }[];
    variants: VariantInput[];
    lowStockThreshold?: number;
    seoTitle: string;
    seoDescription: string;
    published: boolean;
}

export interface CategoryInput {
    id?: string;
    name: string;
    slug: string;
    parentId: string | null;
    description: string;
}

export interface SettingsInput {
    storeName: string;
    currency: string;
    currencySymbol: string;
    taxRate: number;
    shippingFlat: number;
    lowStockThreshold: number;
}

export const api = {
    // settings
    getSettings: () => request<{ settings: Settings }>("getSettings"),
    saveSettings: (settings: SettingsInput) => request<{ settings: Settings }>("saveSettings", {settings}),

    // categories
    listCategories: () => request<{ categories: Category[] }>("listCategories"),
    saveCategory: (category: CategoryInput) => request<{ category: Category }>("saveCategory", {category}),
    removeCategory: (id: string) => request<{ ok: true }>("removeCategory", {id}),

    // products
    listItems: () => request<{ items: Product[]; defaultLowStockThreshold: number }>("listItems"),
    getItem: (id: string) => request<{ item: Product }>("getItem", {id}),
    saveItem: (item: ProductInput) => request<{ item: Product }>("saveItem", {item}),
    removeItem: (id: string) => request<{ ok: true }>("removeItem", {id}),

    // stock
    adjustStock: (args: {
        itemId: string;
        variantId: string;
        mode: "set" | "delta";
        amount: number;
        type: string;
        reason: string;
    }) => request<{ item: Product; movement: Movement }>("adjustStock", args),
    listMovements: (itemId: string) => request<{ movements: Movement[] }>("listMovements", {itemId}),

    // dashboard
    summary: () => request<DashboardSummary>("summary"),

    // orders
    listOrders: (args: { status: string; search: string }) => request<{ orders: Order[] }>("listOrders", args),
    getOrder: (id: string) =>
        request<{ order: Order; payments: Payment[]; returns: ReturnRecord[] }>("getOrder", {id}),
    updateOrderStatus: (id: string, status: string) =>
        request<{ order: Order }>("updateOrderStatus", {id, status}),
    recordPayment: (args: { orderId: string; amount: number; method: string }) =>
        request<{ order: Order; payment: Payment }>("recordPayment", args),
    refundPayment: (args: { orderId: string; amount: number; method: string }) =>
        request<{ order: Order; payment: Payment }>("refundPayment", args),
    listPayments: () => request<{ payments: Payment[] }>("listPayments"),

    // returns
    createReturn: (args: {
        orderId: string;
        lines: { itemId: string; variantId: string; qty: number }[];
        reason: string;
        restock: boolean;
    }) => request<{ return: ReturnRecord }>("createReturn", args),
    listReturns: (status: string) => request<{ returns: ReturnRecord[] }>("listReturns", {status}),
    processReturn: (id: string) => request<{ return: ReturnRecord }>("processReturn", {id}),
    updateReturnStatus: (id: string, status: string) =>
        request<{ return: ReturnRecord }>("updateReturnStatus", {id, status}),
};
