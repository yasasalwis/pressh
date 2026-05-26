#!/usr/bin/env node
// pressh-build-panel — bundles a React + TS plugin admin panel into the single
// self-contained `panel.html` the sandboxed Pressh iframe requires.
//
//   pressh-build-panel <entry> [--out <file>] [--root <dir>]
//
//   <entry>        Panel entry module (e.g. src/main.tsx).
//   --out, -o      Output HTML file. Default: ./panel.html
//   --root         Vite root used to resolve node_modules. Default: entry's dir.
//
// The output is the panel BODY (a `<div id="pressh-root">` + inline <style> +
// inline <script>); the Studio wraps it with the host bridge before serving it.

import {buildPanelHtml} from "../build/index.mjs";
import {writeFile, mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname, resolve} from "node:path";

const USAGE = `Usage: pressh-build-panel <entry> [--out <file>] [--root <dir>]

  <entry>      Panel entry module (e.g. src/main.tsx)
  --out, -o    Output HTML file (default: ./panel.html)
  --root       Vite root for node_modules resolution (default: entry's dir)
  --help, -h   Show this help`;

function parseArgs(argv) {
    const opts = {entry: null, out: null, root: null};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            console.log(USAGE);
            process.exit(0);
        } else if (arg === "--out" || arg === "-o") {
            opts.out = argv[++i];
        } else if (arg === "--root") {
            opts.root = argv[++i];
        } else if (arg.startsWith("--out=")) {
            opts.out = arg.slice("--out=".length);
        } else if (arg.startsWith("--root=")) {
            opts.root = arg.slice("--root=".length);
        } else if (arg.startsWith("-")) {
            fail(`Unknown option: ${arg}`);
        } else if (opts.entry === null) {
            opts.entry = arg;
        } else {
            fail(`Unexpected argument: ${arg}`);
        }
    }
    return opts;
}

function fail(message) {
    console.error(`pressh-build-panel: ${message}\n\n${USAGE}`);
    process.exit(1);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (!opts.entry) fail("missing required <entry> argument");

    const entry = resolve(process.cwd(), opts.entry);
    if (!existsSync(entry)) fail(`entry not found: ${entry}`);
    const out = resolve(process.cwd(), opts.out ?? "panel.html");
    const root = opts.root ? resolve(process.cwd(), opts.root) : undefined;

    const {html, jsBytes, cssBytes} = await buildPanelHtml({entry, root});

    await mkdir(dirname(out), {recursive: true});
    await writeFile(out, html, "utf8");

    console.log(
        `Built ${out} — ${(jsBytes / 1024).toFixed(0)}KB js` +
        (cssBytes ? `, ${(cssBytes / 1024).toFixed(0)}KB css` : ""),
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
