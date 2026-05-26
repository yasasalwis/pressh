/**
 * @pressh/panel-kit — the public React + TypeScript authoring kit for Pressh
 * plugin admin panels.
 *
 * Panels render inside an iframe that is sandboxed WITHOUT `allow-same-origin`
 * (null origin), so the ONLY channel to the Studio is `postMessage`, brokered by
 * the host shim it injects as `window.presshPanel`. This module wraps that shim
 * in a typed `request()`, a `usePanelQuery` data hook, and a `mountPanel` helper
 * so plugin authors write React + TS instead of raw HTML + vanilla JS.
 *
 * The companion `pressh-build-panel` CLI (this package's `bin`) bundles a panel's
 * `main.tsx` into the single self-contained `panel.html` the iframe requires.
 */
import {useCallback, useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import type {ReactNode} from "react";

export interface PresshPanelBridge {
    request<T = unknown>(action: string, payload?: unknown): Promise<T>;
}

declare global {
    interface Window {
        presshPanel?: PresshPanelBridge;
    }
}

/**
 * Calls a host action through the Studio bridge. The action must be allow-listed
 * in the plugin manifest's `panelActions`; anything else is rejected host-side.
 * Rejects if the bridge is absent (e.g. the panel was opened outside the Studio).
 */
export async function request<T = unknown>(action: string, payload?: unknown): Promise<T> {
    const bridge = typeof window !== "undefined" ? window.presshPanel : undefined;
    if (!bridge || typeof bridge.request !== "function") {
        throw new Error("Panel host bridge is unavailable");
    }
    return bridge.request<T>(action, payload);
}

export interface QueryState<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    /** Re-runs the query. */
    reload: () => void;
}

/**
 * Loads data from a host action with loading/error/data state and a `reload`.
 * Stale responses (after a dependency change or unmount) are discarded so the
 * UI never flashes data from a superseded request.
 *
 * `payload` is intentionally tracked via `deps` (callers pass primitives), not by
 * object identity — pass the primitives the payload depends on in `deps`.
 */
export function usePanelQuery<T>(
    action: string,
    payload?: unknown,
    deps: readonly unknown[] = [],
): QueryState<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const reqId = useRef(0);

    const reload = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        const id = ++reqId.current;
        setLoading(true);
        setError(null);
        request<T>(action, payload)
            .then((r) => {
                if (id === reqId.current) {
                    setData(r);
                    setLoading(false);
                }
            })
            .catch((e: unknown) => {
                if (id === reqId.current) {
                    setError(e instanceof Error ? e.message : String(e));
                    setLoading(false);
                }
            });
    }, [action, tick, ...deps]);

    return {data, loading, error, reload};
}

/**
 * Mounts a panel's root React element into the container the build CLI emits
 * (`<div id="pressh-root">`). Call this once from your panel's `main.tsx`.
 */
export function mountPanel(node: ReactNode, rootId = "pressh-root"): void {
    const el = document.getElementById(rootId);
    if (!el) {
        throw new Error(`Panel root element #${rootId} not found`);
    }
    createRoot(el).render(node);
}
