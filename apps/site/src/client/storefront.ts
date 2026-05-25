/**
 * Storefront client — progressive enhancement for the inventory plugin's
 * designer widgets (add-to-cart, mini-cart count, cart + checkout). Runs on
 * every page but no-ops unless commerce widgets are present.
 *
 * The cart lives in localStorage (the public site is stateless); prices and
 * stock are always re-validated server-side via the plugin's public endpoints
 * (`/api/p/inventory/cart` and `/checkout`). No inline styles/handlers are used,
 * so it stays within the site's strict CSP — styling ships in storefront.css.
 */
import "./storefront.css";

interface CartLine {
    itemId: string;
    variantId: string;
    qty: number;
}

const CART_KEY = "pressh_cart_v1";
const API = "/api/p/inventory";

// ── cart storage ──────────────────────────────────────────────────────────────
function getCart(): CartLine[] {
    try {
        const raw = JSON.parse(localStorage.getItem(CART_KEY) ?? "[]") as unknown;
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((l): l is CartLine => !!l && typeof l === "object")
            .map((l) => ({
                itemId: String((l as CartLine).itemId ?? ""),
                variantId: String((l as CartLine).variantId ?? ""),
                qty: Math.max(1, Math.min(999, Math.floor(Number((l as CartLine).qty) || 1))),
            }))
            .filter((l) => l.itemId);
    } catch {
        return [];
    }
}

function setCart(cart: CartLine[]): void {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCounts();
}

function cartCount(): number {
    return getCart().reduce((sum, l) => sum + l.qty, 0);
}

function addToCart(itemId: string, variantId: string, qty: number): void {
    if (!itemId) return;
    const cart = getCart();
    const existing = cart.find((l) => l.itemId === itemId && l.variantId === variantId);
    if (existing) existing.qty = Math.min(999, existing.qty + qty);
    else cart.push({itemId, variantId, qty});
    setCart(cart);
}

function setQty(itemId: string, variantId: string, qty: number): void {
    let cart = getCart();
    if (qty <= 0) cart = cart.filter((l) => !(l.itemId === itemId && l.variantId === variantId));
    else {
        const line = cart.find((l) => l.itemId === itemId && l.variantId === variantId);
        if (line) line.qty = Math.min(999, qty);
    }
    setCart(cart);
}

// ── tiny DOM helper (no inline styles/handlers) ────────────────────────────────
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

function el(tag: string, attrs: Attrs = {}, children: (Node | string | null)[] = []): HTMLElement {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") node.className = String(v);
        else if (k === "text") node.textContent = String(v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v as EventListener);
        else node.setAttribute(k, String(v));
    }
    for (const c of children) {
        if (c == null) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
}

interface PreviewLine {
    itemId: string;
    variantId: string;
    name: string;
    variantLabel?: string;
    image?: string;
    qty: number;
    available: number;
    adjusted?: boolean;
    removed?: boolean;
    unitPriceLabel?: string;
    lineTotalLabel?: string;
}

interface Preview {
    lines: PreviewLine[];
    subtotalLabel: string;
    taxLabel: string;
    tax: number;
    shippingLabel: string;
    shipping: number;
    totalLabel: string;
}

async function api<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API}/${path}`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; error?: { code?: string } };
    if (!res.ok || !json.ok) throw new Error(json.error?.code ?? "request_failed");
    return (json.result ?? {}) as T;
}

// ── mini-cart count ────────────────────────────────────────────────────────────
function updateCounts(): void {
    const count = cartCount();
    document.querySelectorAll("[data-ps-cart-count]").forEach((node) => {
        node.textContent = String(count);
    });
}

// ── add-to-cart wiring (event delegation) ──────────────────────────────────────
function wireAddButtons(): void {
    document.addEventListener("click", (e) => {
        const target = e.target as Element | null;
        const btn = target?.closest("[data-ps-add]") as HTMLElement | null;
        if (!btn) return;
        e.preventDefault();
        const itemId = btn.getAttribute("data-ps-add") ?? "";
        if (!itemId) return;
        const variantId = btn.getAttribute("data-ps-variant") ?? "";
        const qty = Math.max(1, Math.floor(Number(btn.getAttribute("data-ps-qty")) || 1));
        addToCart(itemId, variantId, qty);
        const original = btn.textContent;
        btn.textContent = "Added ✓";
        window.setTimeout(() => {
            btn.textContent = original;
        }, 1200);
    });

    // A mini-cart button jumps to a cart/checkout widget if one is on the page.
    document.querySelectorAll('[data-ps-commerce="cartButton"]').forEach((b) => {
        b.addEventListener("click", () => {
            const dest = document.querySelector('[data-ps-commerce="cart"],[data-ps-commerce="checkout"]');
            if (dest) (dest as HTMLElement).scrollIntoView({behavior: "smooth"});
        });
    });
}

// ── cart widget ─────────────────────────────────────────────────────────────────
function cartLineEl(line: PreviewLine, refresh: () => void): HTMLElement {
    if (line.removed) {
        return el("div", {class: "ps-cart-line"}, [
            el("div", {class: "ps-cl-main"}, [
                el("div", {class: "ps-cl-name", text: line.name}),
                el("div", {class: "ps-cl-meta", text: "No longer available"}),
            ]),
            el("button", {
                class: "ps-cl-remove",
                type: "button",
                text: "Remove",
                onclick: () => {
                    setQty(line.itemId, line.variantId, 0);
                    refresh();
                },
            }),
        ]);
    }
    const meta = [line.variantLabel && line.variantLabel !== "Default" ? line.variantLabel : "", line.unitPriceLabel ?? ""]
        .filter(Boolean)
        .join(" · ");
    return el("div", {class: "ps-cart-line"}, [
        line.image ? el("img", {src: line.image, alt: line.name, loading: "lazy"}) : null,
        el("div", {class: "ps-cl-main"}, [
            el("div", {class: "ps-cl-name", text: line.name}),
            el("div", {class: "ps-cl-meta", text: meta}),
            line.adjusted ? el("div", {class: "ps-note", text: `Only ${line.available} in stock`}) : null,
        ]),
        el("div", {class: "ps-qty"}, [
            el("button", {
                type: "button",
                text: "−",
                onclick: () => {
                    setQty(line.itemId, line.variantId, line.qty - 1);
                    refresh();
                },
            }),
            el("span", {text: String(line.qty)}),
            el("button", {
                type: "button",
                text: "+",
                onclick: () => {
                    setQty(line.itemId, line.variantId, line.qty + 1);
                    refresh();
                },
            }),
        ]),
        el("div", {class: "ps-cl-total", text: line.lineTotalLabel ?? ""}),
        el("button", {
            class: "ps-cl-remove",
            type: "button",
            text: "Remove",
            onclick: () => {
                setQty(line.itemId, line.variantId, 0);
                refresh();
            },
        }),
    ]);
}

function totalsEl(p: Preview): HTMLElement {
    const rows: (Node | null)[] = [
        el("div", {class: "ps-row"}, [el("span", {text: "Subtotal"}), el("span", {text: p.subtotalLabel})]),
        p.tax > 0 ? el("div", {class: "ps-row"}, [el("span", {text: "Tax"}), el("span", {text: p.taxLabel})]) : null,
        p.shipping > 0 ? el("div", {class: "ps-row"}, [el("span", {text: "Shipping"}), el("span", {text: p.shippingLabel})]) : null,
        el("div", {class: "ps-row ps-total"}, [el("span", {text: "Total"}), el("span", {text: p.totalLabel})]),
    ];
    return el("div", {class: "ps-cart-totals"}, rows.filter((r): r is Node => r != null));
}

async function renderCart(widget: Element): Promise<void> {
    const mount = (widget.querySelector("[data-ps-cart]") as HTMLElement | null) ?? (widget as HTMLElement);
    const cart = getCart();
    if (!cart.length) {
        mount.replaceChildren(el("p", {class: "ps-cart-empty", text: "Your cart is empty."}));
        return;
    }
    mount.replaceChildren(el("p", {class: "ps-cart-empty", text: "Loading…"}));
    let data: Preview;
    try {
        data = await api<Preview>("cart", {items: cart});
    } catch {
        mount.replaceChildren(el("p", {class: "ps-cart-empty", text: "Could not load your cart."}));
        return;
    }
    const frag = document.createDocumentFragment();
    for (const line of data.lines) frag.appendChild(cartLineEl(line, () => void renderCart(widget)));
    frag.appendChild(totalsEl(data));
    mount.replaceChildren(frag);
}

// ── checkout widget ──────────────────────────────────────────────────────────────
function field(name: string, label: string, type: string, required: boolean, textarea = false): HTMLElement {
    const input = textarea
        ? el("textarea", {name, rows: 3})
        : el("input", {name, type, ...(required ? {required: true} : {})});
    return el("div", {class: "ps-field"}, [el("label", {text: label + (required ? " *" : "")}), input]);
}

async function renderCheckout(widget: Element): Promise<void> {
    const mount = (widget.querySelector("[data-ps-checkout]") as HTMLElement | null) ?? (widget as HTMLElement);
    const cart = getCart();
    if (!cart.length) {
        mount.replaceChildren(el("p", {class: "ps-cart-empty", text: "Your cart is empty."}));
        return;
    }
    mount.replaceChildren(el("p", {class: "ps-cart-empty", text: "Loading…"}));
    let data: Preview;
    try {
        data = await api<Preview>("cart", {items: cart});
    } catch {
        mount.replaceChildren(el("p", {class: "ps-cart-empty", text: "Could not load your order."}));
        return;
    }

    const summary = el("div", {class: "ps-checkout-summary"});
    for (const line of data.lines) {
        summary.appendChild(
            el("div", {class: "ps-row"}, [
                el("span", {text: `${line.name}${line.variantLabel && line.variantLabel !== "Default" ? ` (${line.variantLabel})` : ""} × ${line.qty}`}),
                el("span", {text: line.lineTotalLabel ?? ""}),
            ]),
        );
    }
    summary.appendChild(totalsEl(data));

    const form = el("form", {class: "ps-checkout-form"}, [
        field("name", "Name", "text", true),
        field("email", "Email", "email", true),
        field("phone", "Phone", "tel", false),
        field("address", "Shipping address", "text", false, true),
        field("note", "Order note", "text", false, true),
    ]);
    const msg = el("div", {class: "ps-msg"});
    const submit = el("button", {class: "ps-btn", type: "submit", text: "Place order"});
    form.appendChild(submit);
    form.appendChild(msg);

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(form as HTMLFormElement);
        const customer = {
            name: String(fd.get("name") ?? "").trim(),
            email: String(fd.get("email") ?? "").trim(),
            phone: String(fd.get("phone") ?? "").trim(),
            address: String(fd.get("address") ?? "").trim(),
        };
        const note = String(fd.get("note") ?? "").trim();
        if (!customer.name || !customer.email) {
            msg.textContent = "Please enter your name and email.";
            msg.className = "ps-msg ps-err";
            return;
        }
        (submit as HTMLButtonElement).disabled = true;
        msg.textContent = "Placing your order…";
        msg.className = "ps-msg";
        void api<{ orderNumber: number; totalLabel: string }>("checkout", {items: getCart(), customer, note})
            .then((res) => {
                setCart([]);
                widget.replaceChildren(
                    el("div", {class: "ps-success"}, [
                        el("h3", {text: "Thank you! 🎉"}),
                        el("p", {text: `Your order #${res.orderNumber} (${res.totalLabel}) has been placed.`}),
                        el("p", {
                            class: "ps-cl-meta",
                            text: "We've recorded your order and will be in touch by email."
                        }),
                    ]),
                );
            })
            .catch((err: unknown) => {
                const code = err instanceof Error ? err.message : "error";
                msg.textContent =
                    code === "validation"
                        ? "Something in your cart changed (price or stock). Please review your cart and try again."
                        : "We couldn't place your order. Please try again.";
                msg.className = "ps-msg ps-err";
                (submit as HTMLButtonElement).disabled = false;
            });
    });

    mount.replaceChildren(summary, form);
}

// ── init ─────────────────────────────────────────────────────────────────────────
export function initStorefront(): void {
    if (typeof document === "undefined") return;
    updateCounts();
    wireAddButtons();
    document.querySelectorAll('[data-ps-commerce="cart"]').forEach((w) => void renderCart(w));
    document.querySelectorAll('[data-ps-commerce="checkout"]').forEach((w) => void renderCheckout(w));
    // Keep the count in sync across tabs.
    window.addEventListener("storage", (e) => {
        if (e.key === CART_KEY) updateCounts();
    });
}
