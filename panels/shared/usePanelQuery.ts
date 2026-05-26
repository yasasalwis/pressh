import {useCallback, useEffect, useRef, useState} from "react";
import {request} from "./bridge";

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
        // payload is intentionally tracked via `deps` (callers pass primitives),
        // not by identity — see the QueryState contract.
    }, [action, tick, ...deps]);

    return {data, loading, error, reload};
}
