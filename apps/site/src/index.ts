/**
 * @pressh/site — public-facing site process (Hono + server-rendered HTML).
 *
 * Phase 9: front controller, dynamic plugin API dispatcher, block renderer,
 * content-tag cache, sitemap/robots, strict security headers. React/Vite
 * component theming integrates in Phase 11.
 */
export { createSiteApp } from "./app.js";
export type { SiteAppDeps, SitePluginHost } from "./app.js";
export { createRenderCache } from "./cache.js";
export type { RenderCache } from "./cache.js";
export { renderBlock, renderBlocks, renderPage, escapeHtml } from "./render.js";
export { createSiteServer } from "./server.js";
export type { SiteServerOptions } from "./server.js";
