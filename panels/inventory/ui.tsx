import type {ReactNode} from "react";

/** Inline status/error/loading message line. */
export function Msg({text, kind}: { text: string; kind?: "ok" | "err" | "muted" }) {
    return <span className={"msg " + (kind ?? "muted")}>{text}</span>;
}

const ORDER_BADGE: Record<string, string> = {
    pending: "off",
    paid: "",
    fulfilled: "",
    cancelled: "low",
    refunded: "low",
    requested: "off",
    approved: "",
    received: "",
    rejected: "low",
};

export function StatusBadge({status}: { status: string }) {
    const cls = ORDER_BADGE[status] ?? "off";
    return <span className={"tag " + cls}>{status || "—"}</span>;
}

const PAY_BADGE: Record<string, string> = {unpaid: "low", partial: "off", paid: "", refunded: "low"};

export function PayBadge({status}: { status: string }) {
    const cls = PAY_BADGE[status] ?? "off";
    return <span className={"tag " + cls}>{status || "unpaid"}</span>;
}

export function Empty({children}: { children: ReactNode }) {
    return <div className="empty">{children}</div>;
}

export function Loading() {
    return <p className="muted">Loading…</p>;
}

export function ErrorText({children}: { children: ReactNode }) {
    return <p className="err">{children}</p>;
}

/** KPI stat card used on the dashboard. */
export function StatCard({label, value}: { label: string; value: ReactNode }) {
    return (
        <div className="card" style={{margin: 0}}>
            <div className="muted" style={{fontSize: 12}}>
                {label}
            </div>
            <div className="kpi">{value}</div>
        </div>
    );
}
