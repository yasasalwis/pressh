import sanitizeHtml from "sanitize-html";
import { safeUrl as safeUrlImpl } from "../../url.js";

export const safeUrl = safeUrlImpl;

/** HTML-escape a value for use in text content or attribute values. */
export function e(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Allowlist sanitizer for `richtext` props. These values are interpolated as
 * raw HTML (not escaped — that would defeat the formatting feature), so they
 * MUST be sanitized: `<script>`, `on*` handlers, and `javascript:`/`data:`
 * URLs are stripped. Mirrors the block system's STRICT/RICH posture.
 */
const RICHTEXT_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "b", "i", "em", "strong", "u", "s", "a", "br", "span", "code",
    "p", "h2", "h3", "h4", "ul", "ol", "li", "blockquote",
  ],
  allowedAttributes: { a: ["href", "title", "rel", "target"] },
  allowedSchemes: ["http", "https", "mailto"],
  disallowedTagsMode: "discard",
  transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true) },
};

/** Sanitizes an untrusted `richtext` prop to a safe HTML fragment. */
export function richtext(value: unknown): string {
  return sanitizeHtml(String(value ?? ""), RICHTEXT_OPTS);
}

const CSS_COLOR_RE =
  /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d.,%\s/]+\)$|^hsla?\([\d.,%\s/]+\)$/;
const NAMED_COLORS = new Set([
  "transparent", "currentColor", "inherit", "initial", "unset",
  "black", "white", "red", "green", "blue", "none",
]);

/**
 * Validates a `color` prop before it is placed inside a `style="…"` attribute.
 * `e()` escapes HTML but NOT CSS metacharacters (`: ; ( ) /`), so an escaped
 * color value can still inject extra CSS declarations. This restricts the value
 * to hex / rgb(a) / hsl(a) / a small keyword set; anything else returns the
 * fallback. Use this — never `e()` — for any value that lands in a CSS sink.
 */
export function cssColor(value: unknown, fallback = ""): string {
  const raw = String(value ?? "").trim();
  if (CSS_COLOR_RE.test(raw) || NAMED_COLORS.has(raw)) return raw;
  return fallback;
}

/**
 * Validates a URL destined for a CSS `url(...)` sink (e.g. background-image).
 * Runs the scheme allowlist, then rejects any URL containing characters that
 * could break out of `url("…")` and inject extra CSS. Returns a ready-to-use
 * `url("…")` token, or "" when unsafe. Mirrors the primitive renderer's guard.
 */
export function cssUrl(value: unknown): string {
  const url = safeUrlImpl(value);
  if (!url || /["'()\s\\<>]/.test(url)) return "";
  return `url("${url}")`;
}
