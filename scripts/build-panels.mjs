#!/usr/bin/env node
// Builds each React+TS plugin panel under `panels/<plugin>/main.tsx` into a
// single self-contained `builtins/<plugin>/panel.html` (root div + inline CSS +
// inline IIFE JS, with React bundled in). The output is the panel BODY that the
// Studio wraps via `wrapPanelHtml` and serves into a sandboxed iframe.
//
// Why inline: the panel iframe is sandboxed WITHOUT allow-same-origin (opaque
// origin), and its CSP is `script-src 'unsafe-inline'` with NO 'self' — so an
// external <script src> bundle cannot load. Inlining keeps the existing CSP.
//
// Run BEFORE `sign:builtins` (the signature hashes panel.html). Panel SOURCE in
// panels/ deliberately lives outside builtins/ so it is never signed/shipped.

import {build} from "vite";
import react from "@vitejs/plugin-react";
import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {tmpdir} from "node:os";
import {randomBytes} from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PANELS_SRC = join(ROOT, "panels");
const BUILTINS = join(ROOT, "builtins");

/** Vite-builds one panel into a temp dir and inlines the result into panel.html. */
async function buildPanel(plugin) {
    const entry = join(PANELS_SRC, plugin, "main.tsx");
    const outDir = join(tmpdir(), `pressh-panel-${plugin}-${randomBytes(6).toString("hex")}`);

    await build({
        root: PANELS_SRC,
        configFile: false,
        logLevel: "warn",
        plugins: [react()],
        // React reads process.env.NODE_ENV; the iframe has no `process`, so it MUST
        // be statically replaced at build time (Vite's production build does this,
        // set explicitly here to be certain we ship React's production build).
        define: {"process.env.NODE_ENV": JSON.stringify("production")},
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
    await rm(outDir, {recursive: true, force: true});

    if (js.includes("process.env")) {
        throw new Error(
            `panel ${plugin}: bundle still references process.env — it would crash in the iframe`,
        );
    }
    // Defensively escape any literal `</script` in the bundle (only ever occurs
    // inside JS string/regex literals after minification, where `<\/script` is
    // equivalent) so it can't prematurely close the inline <script>. A `</style`
    // in CSS essentially never happens — fail loud rather than corrupt the panel.
    const safeJs = js.replace(/<\/script/gi, "<\\/script");
    if (/<\/style/i.test(css)) {
        throw new Error(`panel ${plugin}: CSS contains a literal </style — cannot inline safely`);
    }

    const body =
        `<div id="pressh-root"></div>\n` +
        (css ? `<style>${css}</style>\n` : "") +
        `<script>${safeJs}</script>\n`;
    await writeFile(join(BUILTINS, plugin, "panel.html"), body, "utf8");
    return {plugin, jsBytes: js.length, cssBytes: css.length};
}

async function main() {
    let entries;
    try {
        entries = await readdir(PANELS_SRC, {withFileTypes: true});
    } catch {
        console.log("No panels/ directory — nothing to build.");
        return;
    }
    const plugins = entries
        .filter(
            (e) =>
                e.isDirectory() &&
                e.name !== "shared" &&
                !e.name.startsWith("_") &&
                existsSync(join(PANELS_SRC, e.name, "main.tsx")),
        )
        .map((e) => e.name);

    if (!plugins.length) {
        console.log("No panels/<plugin>/main.tsx entries found.");
        return;
    }

    for (const plugin of plugins) {
        const r = await buildPanel(plugin);
        console.log(
            `built panel ${r.plugin}: ${(r.jsBytes / 1024).toFixed(0)}KB js` +
            (r.cssBytes ? `, ${(r.cssBytes / 1024).toFixed(0)}KB css` : ""),
        );
    }
    console.log(`Built ${plugins.length} panel(s) into builtins/.`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
