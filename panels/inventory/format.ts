// Pure formatting/util helpers shared across the inventory panel.

/** Mirrors the server-side slugify (index.mjs) for the live slug preview. */
export function slugify(s: string): string {
    return String(s ?? "")
        .toLowerCase()
        .trim()
        .replace(/['"]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

/** A human label for a variant from its option values ("S / Black"), else "Default". */
export function variantLabel(optionValues: Record<string, string> | undefined): string {
    const parts = Object.values(optionValues ?? {})
        .map((v) => String(v ?? ""))
        .filter(Boolean);
    return parts.length ? parts.join(" / ") : "Default";
}

export function fmtDate(s: string | undefined): string {
    const d = new Date(s ?? "");
    return isNaN(d.getTime()) ? String(s ?? "") : d.toLocaleString();
}

export function moneyWith(symbol: string, n: unknown): string {
    const v = Number(n);
    return symbol + (Number.isFinite(v) ? v.toFixed(2) : "0.00");
}

/** Cartesian product of option axes → list of {optName: value} maps. */
export function cartesian(options: { name: string; values: string[] }[]): Record<string, string>[] {
    let acc: Record<string, string>[] = [{}];
    for (const opt of options) {
        const next: Record<string, string>[] = [];
        for (const combo of acc) {
            for (const value of opt.values) next.push({...combo, [opt.name]: value});
        }
        if (next.length) acc = next;
    }
    return acc;
}
