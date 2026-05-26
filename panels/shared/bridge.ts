// Typed access to the Studio host bridge. Plugin panels render inside a sandboxed
// iframe (null origin, no allow-same-origin); the ONLY channel to the host is
// `window.presshPanel.request(action, payload)`, injected by the Studio wrapper
// (packages/runtime/src/iframe-shim → PANEL_SHIM_JS). Every call is relayed to
// the cap-gated, CSRF-checked invoke endpoint and allow-listed by panelActions.

export interface PresshPanelBridge {
    request<T = unknown>(action: string, payload?: unknown): Promise<T>;
}

declare global {
    interface Window {
        presshPanel?: PresshPanelBridge;
    }
}

/** Calls a host action through the bridge. Rejects if the bridge is absent. */
export async function request<T = unknown>(action: string, payload?: unknown): Promise<T> {
    const bridge = window.presshPanel;
    if (!bridge || typeof bridge.request !== "function") {
        throw new Error("Panel host bridge is unavailable");
    }
    return bridge.request<T>(action, payload);
}
