/**
 * Scheme allowlist for any URL that lands in an href/src/url() sink.
 * Relative URLs (no scheme) are always allowed; everything with an explicit
 * scheme must be one of these. Blocks javascript:, data:, vbscript:, file:, etc.
 */
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/**
 * Strips characters browsers ignore when resolving a URL's scheme — C0 controls
 * (incl. TAB/LF/CR/NUL), DEL, C1 controls, and the line/paragraph separators.
 * Done before the scheme test so "java\tscript:alert(1)" and similar cannot
 * smuggle a blocked scheme past it. Operates on a throwaway probe string only.
 */
function stripSchemeNoise(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const isControl = c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
    if (!isControl) out += ch;
  }
  return out;
}

/**
 * Returns `value` unchanged when it is safe to place in a link/image URL sink,
 * or `""` when it carries a disallowed scheme. The single source of truth for
 * URL safety in the engine — block sanitizers and component renderers both use
 * it so a new block can't reintroduce a `javascript:` URL by forgetting to check.
 */
export function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(stripSchemeNoise(raw));
  if (m) {
    const scheme = (m[1] ?? "").toLowerCase();
    return ALLOWED_SCHEMES.has(scheme) ? raw : "";
  }
  // No explicit scheme → relative path, root-relative, anchor, or query. Safe.
  return raw;
}
