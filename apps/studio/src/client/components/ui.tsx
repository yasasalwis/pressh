import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from "react";

// ── Toast ──────────────────────────────────────────────────────────────
type ToastFn = (msg: string, err?: boolean) => void;
const ToastCtx = createContext<ToastFn>(() => {
});
export const useToast = (): ToastFn => useContext(ToastCtx);

export function ToastProvider({children}: { children: ReactNode }) {
    const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
    const show = useCallback<ToastFn>((msg, err) => setToast({msg, err}), []);
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 2600);
        return () => clearTimeout(t);
    }, [toast]);
    return (
        <ToastCtx.Provider value={show}>
            {children}
            {toast && <div id="toast" className={"show" + (toast.err ? " err" : "")}>{toast.msg}</div>}
        </ToastCtx.Provider>
    );
}

// ── Modal ──────────────────────────────────────────────────────────────
export function Modal({
                          children,
                          onClose,
                          locked,
                      }: {
    children: ReactNode;
    onClose?: () => void;
    locked?: boolean;
}) {
    return (
        <div
            className="modal-bg"
            onClick={(e) => {
                if (!locked && onClose && e.target === e.currentTarget) onClose();
            }}
        >
            <div className="modal">{children}</div>
        </div>
    );
}

export function ConfirmModal({
                                 title,
                                 message,
                                 confirmLabel = "Confirm",
                                 onConfirm,
                                 onCancel,
                             }: {
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <Modal onClose={onCancel}>
            <h3>{title}</h3>
            <p className="hint">{message}</p>
            <div className="actions">
                <button className="ghost" onClick={onCancel}>
                    Cancel
                </button>
                <button className="btn-sm danger" onClick={onConfirm}>
                    {confirmLabel}
                </button>
            </div>
        </Modal>
    );
}

// ── Section scaffolding ────────────────────────────────────────────────
export function RowHead({title, children}: { title: string; children?: ReactNode }) {
    return (
        <div className="row-head">
            <h2>{title}</h2>
            {children && <div style={{display: "flex", gap: ".5rem"}}>{children}</div>}
        </div>
    );
}

export function Loading() {
    return <div className="loading">Loading…</div>;
}

export function ErrorCard({message}: { message: string }) {
    return (
        <div className="card">
            <div className="alert">{message}</div>
        </div>
    );
}

export function fmtDate(iso: string | number | Date | undefined): string {
    try {
        return new Date(iso ?? "").toLocaleString();
    } catch {
        return String(iso ?? "");
    }
}

// ── Data loader ────────────────────────────────────────────────────────
export interface Loaded<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

export function useLoader<T>(load: () => Promise<T>, deps: readonly unknown[] = []): Loaded<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const reload = useCallback(() => setTick((t) => t + 1), []);
    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        load()
            .then((d) => {
                if (alive) {
                    setData(d);
                    setLoading(false);
                }
            })
            .catch((e: unknown) => {
                if (alive) {
                    setError(e instanceof Error ? e.message : String(e));
                    setLoading(false);
                }
            });
        return () => {
            alive = false;
        };
    }, [tick, ...deps]);
    return {data, loading, error, reload};
}
