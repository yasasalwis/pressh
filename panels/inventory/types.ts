// Domain types mirroring the inventory plugin's stored shapes (builtins/inventory/index.mjs).

export interface Settings {
    id: string;
    storeName: string;
    currency: string;
    currencySymbol: string;
    taxRate: number;
    shippingFlat: number;
    lowStockThreshold: number;
}

export interface OptionAxis {
    name: string;
    values: string[];
}

export interface Variant {
    id: string;
    optionValues: Record<string, string>;
    label: string;
    sku: string;
    price: number | null;
    stock: number;
    lowStockThreshold: number | null;
}

export interface Product {
    id: string;
    name: string;
    slug: string;
    sku: string;
    description: string;
    currency: string;
    price: number;
    compareAtPrice: number | null;
    categoryId: string | null;
    tags: string[];
    images: string[];
    options: OptionAxis[];
    variants: Variant[];
    lowStockThreshold: number | null;
    seoTitle: string;
    seoDescription: string;
    published: boolean;
    createdAt: string;
    updatedAt: string;
    // denormalised roll-ups
    totalStock: number;
    inStock: boolean;
    lowStock: boolean;
    priceMin: number;
    priceMax: number;
    image?: string;
}

export interface Category {
    id: string;
    name: string;
    slug: string;
    description: string;
    parentId: string | null;
    updatedAt: string;
}

export interface Movement {
    id: string;
    itemId: string;
    variantId: string;
    type: string;
    qtyDelta: number;
    balanceAfter: number;
    reason: string;
    ref: string | null;
    at: string;
    seq: number;
}

export interface Customer {
    name: string;
    email: string;
    phone: string;
    address: string;
}

export interface OrderLine {
    itemId: string;
    variantId: string;
    name: string;
    variantLabel: string;
    sku: string;
    image: string;
    unitPrice: number;
    qty: number;
    lineTotal: number;
}

export type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
export type PaymentStatus = "unpaid" | "partial" | "paid" | "refunded";

export interface Order {
    id: string;
    number: number;
    status: OrderStatus;
    lines: OrderLine[];
    subtotal: number;
    tax: number;
    shipping: number;
    discount: number;
    total: number;
    currency: string;
    customer: Customer;
    note: string;
    source: string;
    paymentStatus: PaymentStatus;
    amountPaid: number;
    amountRefunded: number;
    createdAt: string;
    updatedAt: string;
}

export interface Payment {
    id: string;
    orderId: string;
    orderNumber: number;
    kind: "payment" | "refund";
    amount: number;
    method: string;
    status: string;
    note: string;
    at: string;
}

export type ReturnStatus = "requested" | "approved" | "received" | "refunded" | "rejected";

export interface ReturnLine {
    itemId: string;
    variantId: string;
    name: string;
    variantLabel: string;
    qty: number;
    unitPrice: number;
    lineRefund: number;
}

export interface ReturnRecord {
    id: string;
    number: number;
    orderId: string;
    orderNumber: number;
    status: ReturnStatus;
    lines: ReturnLine[];
    reason: string;
    refundAmount: number;
    createdAt: string;
    updatedAt: string;
}

export interface DashboardSummary {
    currency: string;
    currencySymbol: string;
    counts: { products: number; published: number; lowStock: number; categories: number; orders: number };
    revenue: number;
    outstanding: number;
    refunded: number;
    ordersByStatus: Record<string, number>;
    recentOrders: Array<{
        id: string;
        number: number;
        total: number;
        status: OrderStatus;
        paymentStatus: PaymentStatus;
        customer: string;
        createdAt: string;
    }>;
    lowStockProducts: Array<{ id: string; name: string; totalStock: number }>;
}
