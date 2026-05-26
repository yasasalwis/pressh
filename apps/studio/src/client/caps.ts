// Capability matching — mirrors the server-side gate (the server stays
// authoritative; this only drives nav/section visibility in the UI).

function scopeOk(g: string | undefined, r: string | undefined): boolean {
    if (g === "*") return true;
    return (g || null) === (r || null);
}

export function capMatch(granted: string, required: string): boolean {
    if (granted === "*") return true;
    const gs = granted.split(":");
    const rs = required.split(":");
    const gp = (gs[0] ?? "").split(".");
    const rp = (rs[0] ?? "").split(".");
    for (let i = 0; i < gp.length; i++) {
        if (gp[i] === "**") return scopeOk(gs[1], rs[1]);
        if (gp[i] === "*") {
            if (rp[i] === undefined) return false;
            continue;
        }
        if (rp[i] !== gp[i]) return false;
    }
    if (gp.length !== rp.length) return false;
    return scopeOk(gs[1], rs[1]);
}

export function makeCan(capabilities: readonly string[]): (cap: string) => boolean {
    return (cap) => capabilities.some((g) => capMatch(g, cap));
}
