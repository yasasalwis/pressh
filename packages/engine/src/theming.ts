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
    { key: "colorText", group: "color", label: "Text", type: "color", default: "#1a1a1a" },
    { key: "colorPrimary", group: "color", label: "Primary", type: "color", default: "#6d28d9" },
    { key: "fontBody", group: "font", label: "Body font", type: "text", default: "system-ui, sans-serif" },
    { key: "fontHeading", group: "font", label: "Heading font", type: "text", default: "system-ui, sans-serif" },
    { key: "maxWidth", group: "layout", label: "Content width", type: "size", default: "720px" },
    { key: "spacing", group: "layout", label: "Spacing", type: "size", default: "1rem" },
  ],
  layout: (input) =>
    `<!DOCTYPE html>
<html lang="${escapeHtml(input.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
:root{${input.cssVars}}
body{margin:0;background:var(--colorBackground);color:var(--colorText);font-family:var(--fontBody);}
header,main,footer{max-width:var(--maxWidth);margin:0 auto;padding:var(--spacing);}
h1,h2,h3,h4,h5,h6{font-family:var(--fontHeading);}
a{color:var(--colorPrimary);}
</style>
</head>
<body>
<header><strong>${escapeHtml(input.siteName)}</strong></header>
<main>${input.body}</main>
<footer>Powered by Pressh</footer>
</body>
</html>`,
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
