// Build core for Pressh plugin admin panels. Bundles a React + TS panel entry
// (`main.tsx`) into a single self-contained `panel.js` IIFE bundle — React and
// the panel's CSS are inlined into the one script (the CSS is injected at
// runtime via a tiny prelude), so a plugin ships NO HTML file. The host wraps
// the bundle in the sandboxed iframe document at serve time.
//
// Why a single inline script: the panel iframe is sandboxed WITHOUT
// allow-same-origin (opaque origin) and its CSP is `script-src 'unsafe-inline'`
// with NO 'self' — so an external <script src> / <link> cannot load. Everything
// must be inline; the host inlines this bundle into a <script> it generates.
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
 * Bundles a panel entry into a single self-contained JS bundle.
 *
 * @param {object} opts
 * @param {string} opts.entry  Absolute path to the panel entry (e.g. main.tsx).
 * @param {string} [opts.root] Vite root used to resolve node_modules; defaults
 *                             to the entry's directory.
 * @returns {Promise<{ script: string, jsBytes: number, cssBytes: number }>}
 */
export async function buildPanelScript({ entry, root }) {
  if (!entry) throw new Error("buildPanelScript: `entry` is required");
  if (!existsSync(entry)) throw new Error(`buildPanelScript: entry not found: ${entry}`);

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

  // Inject the panel's CSS at runtime so the whole panel is one JS file. The
  // iframe CSP allows style-src 'unsafe-inline', which covers this <style>.
  const prelude = css
    ? `(function(){var s=document.createElement("style");` +
      `s.appendChild(document.createTextNode(${JSON.stringify(css)}));` +
      `document.head.appendChild(s);})();\n`
    : "";

  // Defensively escape any literal `</script` (only ever occurs inside JS/CSS
  // string or regex literals here, where `<\/script` is equivalent) so the
  // bundle can be inlined into a host-generated <script> without closing it.
  const script = (prelude + js).replace(/<\/script/gi, "<\\/script");

  return { script, jsBytes: js.length, cssBytes: css.length };
}
