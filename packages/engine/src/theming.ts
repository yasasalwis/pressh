import { CapabilityGate, PressError } from "@pressh/core";
import type { AuditLog, StorageAdapter, StoredDoc } from "@pressh/core";

/**
 * No-code theming (FR-020). Non-coders adjust a fixed set of design TOKENS;
 * developers author themes (token schema + layout) in TypeScript. Token values
 * are validated against strict per-type patterns so a value can never break out
 * of a CSS declaration — there is no raw template/CSS editing surface.
 */
export type ThemeTokenType = "color" | "text" | "size";

export interface ThemeTokenDef {
  key: string;
  group: string;
  label: string;
  type: ThemeTokenType;
  default: string;
}

export interface ThemeLayoutInput {
  title: string;
  body: string;
  locale: string;
  cssVars: string;
  siteName: string;
  /** Custom header HTML (from the designer). When provided replaces the theme's built-in nav. */
  header?: string;
  /** Custom footer HTML (from the designer). When provided replaces the theme's built-in footer. */
  footer?: string;
}

export interface ThemeDefinition {
  name: string;
  slug: string;
  tokens: ThemeTokenDef[];
  layout(input: ThemeLayoutInput): string;
}

export interface ThemeSettings {
  theme: string;
  tokens: Record<string, string>;
  siteName: string;
}

const TOKEN_PATTERNS: Record<ThemeTokenType, RegExp> = {
  color: /^#[0-9a-fA-F]{3,8}$/,
  size: /^[0-9]+(\.[0-9]+)?(px|rem|em|%|vw|vh)$/,
  text: /^[a-zA-Z0-9 ,'"-]+$/,
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const defaultTheme: ThemeDefinition = {
  name: "Pressh Default",
  slug: "default",
  tokens: [
    { key: "colorBackground", group: "color", label: "Background", type: "color", default: "#ffffff" },
    { key: "colorText", group: "color", label: "Text", type: "color", default: "#0f172a" },
    { key: "colorPrimary", group: "color", label: "Primary", type: "color", default: "#6d28d9" },
    { key: "fontBody", group: "font", label: "Body font", type: "text", default: "system-ui, sans-serif" },
    { key: "fontHeading", group: "font", label: "Heading font", type: "text", default: "system-ui, sans-serif" },
    { key: "maxWidth", group: "layout", label: "Content width", type: "size", default: "760px" },
    { key: "spacing", group: "layout", label: "Spacing", type: "size", default: "1rem" },
  ],
  layout: (input) => {
    // A designer-built header/footer page replaces the theme's built-in chrome;
    // when none is configured, fall back to the default nav + footer so a site
    // is never left without navigation or attribution.
    const defaultNav = `<nav>
  <div class="nav-inner">
    <a class="nav-logo" href="/">
      <div class="nav-mark">P</div>
      ${escapeHtml(input.siteName)}
    </a>
    <ul class="nav-links">
      <li><a href="/">Home</a></li>
      <li><a href="/about">About</a></li>
      <li><a href="/blog">Blog</a></li>
      <li><a href="/contact">Contact</a></li>
    </ul>
  </div>
</nav>`;
    const defaultFooter = `<footer><a href="https://pressh.io" target="_blank" rel="noopener">Powered by Pressh</a></footer>`;
    const headerHtml = input.header ?? defaultNav;
    const footerHtml = input.footer ?? defaultFooter;
    return `<!DOCTYPE html>
<html lang="${escapeHtml(input.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --brand:#6d28d9;--brand-2:#0ea5e9;--brand-glow:rgba(109,40,217,.5);
  --brand-bg:rgba(109,40,217,.07);
  --bg:#ffffff;--bg-subtle:#f8fafc;--border:#e2e8f0;
  --text:#0f172a;--muted:#64748b;
  --nav-h:64px;
  ${input.cssVars}
}
@media(prefers-color-scheme:dark){
  :root{
    --bg:#070c1a;--bg-subtle:#0f172a;--border:rgba(148,163,184,.12);
    --text:#e2e8f0;--muted:#94a3b8;--brand-bg:rgba(109,40,217,.12);
  }
}
body{
  background:var(--colorBackground,var(--bg));
  color:var(--colorText,var(--text));
  font-family:var(--fontBody,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif);
  font-size:1.0625rem;line-height:1.75;
  -webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column;
}
/* ── Default navigation (used when no header layout page is configured) ── */
nav{
  position:sticky;top:0;z-index:10;height:var(--nav-h);
  background:rgba(255,255,255,.82);
  backdrop-filter:saturate(180%) blur(16px);
  -webkit-backdrop-filter:saturate(180%) blur(16px);
  border-bottom:1px solid var(--border);
}
@media(prefers-color-scheme:dark){nav{background:rgba(7,12,26,.82);}}
.nav-inner{
  max-width:var(--maxWidth,760px);width:100%;margin:0 auto;
  padding:0 1.5rem;height:100%;display:flex;align-items:center;gap:1.5rem;
}
.nav-logo{
  display:flex;align-items:center;gap:.55rem;text-decoration:none;
  color:var(--colorText,var(--text));font-weight:800;font-size:.95rem;
  letter-spacing:-.01em;flex-shrink:0;
}
.nav-mark{
  width:30px;height:30px;border-radius:8px;flex-shrink:0;
  background:linear-gradient(135deg,var(--colorPrimary,var(--brand)),var(--brand-2));
  display:grid;place-items:center;color:#fff;font-weight:900;font-size:.8rem;
  box-shadow:0 4px 14px -4px var(--brand-glow);
}
.nav-links{display:flex;gap:.125rem;list-style:none;margin-left:auto;}
.nav-links a{
  padding:.4rem .8rem;border-radius:7px;text-decoration:none;
  color:var(--muted);font-size:.875rem;font-weight:500;
  transition:color .12s,background .12s;
}
.nav-links a:hover{color:var(--colorText,var(--text));background:var(--bg-subtle);}
/* ── Main content ── */
main{
  flex:1;width:100%;max-width:var(--maxWidth,760px);
  margin:0 auto;padding:4.5rem 1.5rem 6rem;
}
/* ── Typography ── */
h1{
  font-family:var(--fontHeading,ui-sans-serif,system-ui,sans-serif);
  font-size:clamp(2.1rem,5vw,3.25rem);font-weight:800;
  line-height:1.12;letter-spacing:-.035em;
  color:var(--colorText,var(--text));
  background:linear-gradient(135deg,var(--colorText,var(--text)) 30%,var(--colorPrimary,var(--brand)) 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  margin-bottom:1.25rem;
}
h2{
  font-family:var(--fontHeading,ui-sans-serif,system-ui,sans-serif);
  font-size:clamp(1.35rem,3vw,1.7rem);font-weight:700;
  letter-spacing:-.025em;color:var(--colorText,var(--text));
  margin-top:3rem;margin-bottom:.75rem;
}
h3{
  font-size:1.2rem;font-weight:700;letter-spacing:-.015em;
  color:var(--colorText,var(--text));margin-top:2.25rem;margin-bottom:.5rem;
}
h4,h5,h6{
  font-size:1rem;font-weight:700;color:var(--colorText,var(--text));
  margin-top:1.75rem;margin-bottom:.4rem;
}
p{color:var(--muted);margin-bottom:1.35rem;max-width:64ch;}
h1+p,h2+p,h3+p{margin-top:.35rem;}
a{
  color:var(--colorPrimary,var(--brand));text-decoration:underline;
  text-underline-offset:3px;text-decoration-color:rgba(109,40,217,.25);
  transition:text-decoration-color .15s;
}
a:hover{text-decoration-color:var(--colorPrimary,var(--brand));}
blockquote{
  border-left:3px solid var(--colorPrimary,var(--brand));
  padding:.875rem 1.25rem;margin:2rem 0;
  background:var(--brand-bg);border-radius:0 10px 10px 0;
  color:var(--muted);font-style:italic;
}
pre{
  background:var(--bg-subtle);border:1px solid var(--border);
  border-radius:12px;padding:1.25rem 1.5rem;overflow-x:auto;
  margin:2rem 0;font-size:.875rem;line-height:1.65;
}
code{font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace;font-size:.875em;}
img{max-width:100%;border-radius:12px;margin:2rem 0;display:block;}
/* ── Default footer ── */
footer{
  border-top:1px solid var(--border);padding:1.75rem 1.5rem;
  display:flex;align-items:center;justify-content:center;gap:.4rem;
  font-size:.8rem;color:var(--muted);
}
footer a{
  color:var(--muted);text-decoration:none;
  border-bottom:1px solid transparent;transition:color .12s,border-color .12s;
}
footer a:hover{color:var(--colorText,var(--text));border-color:var(--border);}
/* ── Responsive ── */
@media(max-width:600px){
  .nav-links{display:none;}
  main{padding:3rem 1.25rem 4.5rem;}
  h1{font-size:2rem;}
  h2{font-size:1.35rem;}
}
</style>
</head>
<body>
${headerHtml}
<main>${input.body}</main>
${footerHtml}
</body>
</html>`;
  },
};

export interface ThemeRegistry {
  get(slug: string): ThemeDefinition | undefined;
  list(): ThemeDefinition[];
}

export function createThemeRegistry(themes: ThemeDefinition[] = [defaultTheme]): ThemeRegistry {
  const map = new Map(themes.map((t) => [t.slug, t]));
  return {
    get: (slug) => map.get(slug),
    list: () => [...map.values()],
  };
}

/** Throws PressError("validation") for unknown tokens or values that fail their type pattern. */
export function validateTokens(theme: ThemeDefinition, tokens: Record<string, string>): void {
  for (const [key, value] of Object.entries(tokens)) {
    const def = theme.tokens.find((d) => d.key === key);
    if (!def) throw new PressError("validation", `Unknown theme token: ${key}`);
    if (!TOKEN_PATTERNS[def.type].test(value)) {
      throw new PressError("validation", `Invalid value for token "${key}"`);
    }
  }
}

export function resolveTokens(
  theme: ThemeDefinition,
  overrides: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const def of theme.tokens) resolved[def.key] = overrides[def.key] ?? def.default;
  return resolved;
}

export function renderCssVars(theme: ThemeDefinition, tokens: Record<string, string>): string {
  return theme.tokens.map((def) => `--${def.key}:${tokens[def.key] ?? def.default};`).join("");
}

const SETTINGS_COLLECTION = "settings";
const THEME_DOC_ID = "theme";
const SAMPLE_BODY = "<h1>Sample heading</h1><p>The quick brown fox jumps over the lazy dog.</p><p><a href=\"#\">A themed link</a></p>";

interface StoredThemeSettings extends StoredDoc {
  theme: string;
  tokens: Record<string, string>;
  siteName: string;
}

export interface ResolvedTheme {
  theme: ThemeDefinition;
  tokens: Record<string, string>;
  cssVars: string;
  siteName: string;
}

export interface ThemeService {
  getSettings(): Promise<ThemeSettings>;
  setSettings(
    capabilities: string[],
    partial: { theme?: string; tokens?: Record<string, string>; siteName?: string },
  ): Promise<ThemeSettings>;
  resolve(): Promise<ResolvedTheme>;
  listThemes(): { slug: string; name: string; tokens: ThemeTokenDef[] }[];
  preview(opts: { theme?: string; tokens?: Record<string, string>; siteName?: string }): string;
}

export interface ThemeServiceOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  registry?: ThemeRegistry;
}

export function createThemeService(opts: ThemeServiceOptions): ThemeService {
  const registry = opts.registry ?? createThemeRegistry([defaultTheme]);
  const gate = new CapabilityGate();
  const fallbackSlug = registry.list()[0]?.slug ?? defaultTheme.slug;

  function requireTheme(slug: string): ThemeDefinition {
    const theme = registry.get(slug);
    if (!theme) throw new PressError("validation", `Unknown theme: ${slug}`);
    return theme;
  }

  async function getSettings(): Promise<ThemeSettings> {
    const result = await opts.storage.get<StoredThemeSettings>(SETTINGS_COLLECTION, THEME_DOC_ID);
    if (!result.ok) throw result.error;
    const doc = result.value;
    if (!doc) return { theme: fallbackSlug, tokens: {}, siteName: "Pressh" };
    return { theme: doc.theme, tokens: doc.tokens, siteName: doc.siteName };
  }

  return {
    getSettings,

    async setSettings(capabilities, partial) {
      gate.assert(capabilities, "themes.manage");
      const current = await getSettings();
      const themeSlug = partial.theme ?? current.theme;
      const theme = requireTheme(themeSlug);
      const tokens = { ...current.tokens, ...(partial.tokens ?? {}) };
      validateTokens(theme, tokens);
      const siteName = partial.siteName ?? current.siteName;

      const doc: StoredThemeSettings = { id: THEME_DOC_ID, theme: themeSlug, tokens, siteName };
      const put = await opts.storage.put(SETTINGS_COLLECTION, doc);
      if (!put.ok) throw put.error;
      await opts.audit.append({ action: "theme.update", actorId: null, detail: { theme: themeSlug } });
      return { theme: themeSlug, tokens, siteName };
    },

    async resolve() {
      const settings = await getSettings();
      const theme = registry.get(settings.theme) ?? defaultTheme;
      const tokens = resolveTokens(theme, settings.tokens);
      return { theme, tokens, cssVars: renderCssVars(theme, tokens), siteName: settings.siteName };
    },

    listThemes() {
      return registry.list().map((t) => ({ slug: t.slug, name: t.name, tokens: t.tokens }));
    },

    preview(opts2) {
      const theme = requireTheme(opts2.theme ?? fallbackSlug);
      const overrides = opts2.tokens ?? {};
      validateTokens(theme, overrides);
      const tokens = resolveTokens(theme, overrides);
      return theme.layout({
        title: "Preview",
        body: SAMPLE_BODY,
        locale: "en",
        cssVars: renderCssVars(theme, tokens),
        siteName: opts2.siteName ?? "Pressh",
      });
    },
  };
}
