// Build core for Pressh plugin admin panels. Bundles a React + TS panel entry
// (`main.tsx`) into a single self-contained panel body: a `<div id="pressh-root">`
// plus an inline <style> and an inline IIFE <script> with React bundled in.
//
// Why inline: the panel iframe is sandboxed WITHOUT allow-same-origin (opaque
// origin) and its CSP is `script-src 'unsafe-inline'` with NO 'self' — so an
// external <script src> bundle cannot load. Inlining keeps the existing CSP.
//
// Used by both the `pressh-build-panel` CLI (this package's bin) and the Pressh
// monorepo's own `scripts/build-panels.mjs` (so first-party panels and
// third-party panels build through the exact same pipeline).

import { build } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

/**
 * Bundles a panel entry into an inlined panel body.
 *
 * @param {object} opts
 * @param {string} opts.entry  Absolute path to the panel entry (e.g. main.tsx).
 * @param {string} [opts.root] Vite root used to resolve node_modules; defaults
 *                             to the entry's directory.
 * @returns {Promise<{ html: string, jsBytes: number, cssBytes: number }>}
 */
export async function buildPanelHtml({ entry, root }) {
  if (!entry) throw new Error("buildPanelHtml: `entry` is required");
  if (!existsSync(entry)) throw new Error(`buildPanelHtml: entry not found: ${entry}`);

  const outDir = join(tmpdir(), `pressh-panel-${randomBytes(8).toString("hex")}`);

  await build({
    root: root ?? dirname(entry),
    configFile: false,
    logLevel: "warn",
    plugins: [react()],
    // React reads process.env.NODE_ENV; the iframe has no `process`, so it MUST
    // be statically replaced at build time so we ship React's production build.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir,
      emptyOutDir: true,
      cssCodeSplit: false,
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: entry,
        output: {
          format: "iife",
          entryFileNames: "panel.js",
          assetFileNames: "panel.[ext]",
          inlineDynamicImports: true,
        },
      },
    },
  });

  const js = await readFile(join(outDir, "panel.js"), "utf8");
  const cssPath = join(outDir, "panel.css");
  const css = existsSync(cssPath) ? await readFile(cssPath, "utf8") : "";
  await rm(outDir, { recursive: true, force: true });

  if (js.includes("process.env")) {
    throw new Error(
      "panel bundle still references process.env — it would crash in the sandboxed iframe",
    );
  }
  // Defensively escape any literal `</script` in the bundle (only ever occurs
  // inside JS string/regex literals after bundling, where `<\/script` is
  // equivalent) so it can't prematurely close the inline <script>.
  const safeJs = js.replace(/<\/script/gi, "<\\/script");
  // A `</style` in CSS essentially never happens — fail loud rather than corrupt.
  if (/<\/style/i.test(css)) {
    throw new Error("panel CSS contains a literal </style — cannot inline safely");
  }

  const html =
    `<div id="pressh-root"></div>\n` +
    (css ? `<style>${css}</style>\n` : "") +
    `<script>${safeJs}</script>\n`;

  return { html, jsBytes: js.length, cssBytes: css.length };
}
