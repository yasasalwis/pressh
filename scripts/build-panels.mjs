#!/usr/bin/env node
// Builds each first-party React+TS plugin panel under `panels/<plugin>/main.tsx`
// into a single self-contained `builtins/<plugin>/panel.js`.
//
// The actual bundling + inlining is the shared `buildPanelScript` from
// `@pressh/panel-kit/build` — the SAME pipeline third-party authors invoke via
// the `pressh-build-panel` CLI. This script just discovers the first-party
// panels and writes the result into builtins/.
//
// Run BEFORE `sign:builtins` (the signature hashes panel.js). Panel SOURCE in
// panels/ deliberately lives outside builtins/ so it is never signed/shipped.

import {buildPanelScript} from "@pressh/panel-kit/build";
import {readdir, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PANELS_SRC = join(ROOT, "panels");
const BUILTINS = join(ROOT, "builtins");

/** Builds one panel and writes it into builtins/<plugin>/panel.js. */
async function buildPanel(plugin) {
    const entry = join(PANELS_SRC, plugin, "main.tsx");
    const {script, jsBytes, cssBytes} = await buildPanelScript({entry, root: PANELS_SRC});
    await writeFile(join(BUILTINS, plugin, "panel.js"), script, "utf8");
    return {plugin, jsBytes, cssBytes};
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
