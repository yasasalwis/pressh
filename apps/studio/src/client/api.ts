// Thin typed wrapper over the Studio admin API. CSRF token is attached to every
// mutating request once it's known (from /admin/api/me).

let csrf = "";

export function setCsrf(token: string): void {
    csrf = token || "";
}

export interface ApiResult<T> {
    status: number;
    body: T;
}

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {
        "content-type": "application/json",
        ...((opts.headers as Record<string, string>) || {}),
    };
    if (csrf && opts.method && opts.method !== "GET") headers["x-csrf-token"] = csrf;
    const res = await fetch(path, {credentials: "same-origin", ...opts, headers});
    const body = (await res.json().catch(() => ({}))) as T;
    return {status: res.status, body};
}

export function errMessage(body: unknown, fallback: string): string {
    const e = (body as { error?: { message?: string } } | null)?.error;
    return (e && e.message) || fallback;
}

export function errCode(body: unknown): string {
    return (body as { error?: { code?: string } } | null)?.error?.code ?? "";
}
