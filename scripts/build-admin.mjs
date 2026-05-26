#!/usr/bin/env node
// Builds the Studio admin React client (apps/studio/src/client/main.tsx) into a
// single self-contained HTML document written to apps/studio/dist/admin-next.html.
// The Studio serves it at /admin/next (a parallel route during the React
// migration; the legacy /admin stays live until the migration completes).
//
// Inlined (like the plugin panels) so serving needs no static-asset plumbing.
// Run AFTER `tsc -b` (which creates apps/studio/dist) so the output survives.

import {build} from "vite";
import react from "@vitejs/plugin-react";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {tmpdir} from "node:os";
import {randomBytes} from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_ROOT = join(ROOT, "apps", "studio", "src", "client");
const ENTRY = join(CLIENT_ROOT, "main.tsx");
const OUT_DIR = join(ROOT, "apps", "studio", "dist");
const OUT_FILE = join(OUT_DIR, "admin-next.html");

async function main() {
    if (!existsSync(ENTRY)) {
        console.log("No apps/studio/src/client/main.tsx — skipping admin build.");
        return;
    }
    const tmp = join(tmpdir(), `pressh-admin-${randomBytes(6).toString("hex")}`);
    await build({
        root: CLIENT_ROOT,
        configFile: false,
        logLevel: "warn",
        plugins: [react()],
        define: {"process.env.NODE_ENV": JSON.stringify("production")},
        build: {
            outDir: tmp,
            emptyOutDir: true,
            cssCodeSplit: false,
            modulePreload: false,
            reportCompressedSize: false,
            rollupOptions: {
                input: ENTRY,
                output: {
                    format: "iife",
                    entryFileNames: "admin.js",
                    assetFileNames: "admin.[ext]",
                    inlineDynamicImports: true
                },
            },
        },
    });

    const js = await readFile(join(tmp, "admin.js"), "utf8");
    const cssPath = join(tmp, "admin.css");
    const css = existsSync(cssPath) ? await readFile(cssPath, "utf8") : "";
    await rm(tmp, {recursive: true, force: true});

    if (js.includes("process.env")) throw new Error("admin bundle still references process.env");
    if (/<\/style/i.test(css)) throw new Error("admin CSS contains a literal </style — cannot inline safely");
    const safeJs = js.replace(/<\/script/gi, "<\\/script");

    const html =
        `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<title>Pressh Studio</title>` +
        (css ? `<style>${css}</style>` : "") +
        `</head><body><div id="pressh-admin-root"></div>` +
        `<script>${safeJs}</script></body></html>`;

    await mkdir(OUT_DIR, {recursive: true});
    await writeFile(OUT_FILE, html, "utf8");
    console.log(
        `built admin client → apps/studio/dist/admin-next.html (${(js.length / 1024).toFixed(0)}KB js` +
        (css ? `, ${(css.length / 1024).toFixed(0)}KB css)` : ")"),
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
