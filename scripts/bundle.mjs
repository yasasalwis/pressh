#!/usr/bin/env node
// Assembles the self-contained standalone build into `.pressh/` — Pressh's
// equivalent of Next.js's `.next`. Runs LAST in `npm run build`, after `tsc -b`,
// the admin/panel builds, `sign:builtins`, and the site client `vite build`: it
// esbuild-bundles their compiled output and copies the runtime assets into a
// single deployable folder. `scripts/run-standalone.mjs` and the Dockerfile run
// the app from this folder.
//
// Layout produced:
//   .pressh/
//     studio/{server.js, seed-cli.js, admin-next.html, runtime/{worker-entry.js, sandbox-loader.js}}
//     site/{server.js, client/, runtime/{worker-entry.js, sandbox-loader.js}}
//     builtins/   signed first-party plugins (copied from ./builtins)
//     plugins/    empty — external plugin drop-in folder
//     node_modules/{better-sqlite3, bindings, file-uri-to-path}   native sqlite
//     package.json
//
// Why the per-app `runtime/` subdir: the plugin worker's OS sandbox grants
// fs-read to ONLY `dirname(workerScript)` + the plugin dir (PluginHost.#spawn).
// Keeping worker-entry/sandbox-loader in their own subdir scopes that grant to a
// code-only directory instead of the whole app dir (which also holds server.js).
// The servers point PluginHost at it via PRESSH_WORKER_SCRIPT.

import {build} from "esbuild";
import {cp, mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".pressh");

// pg / mysql2 / mongodb are pure JS and are bundled straight into the server
// ("native DB drivers built-in"). better-sqlite3 is a native addon — it cannot
// be inlined into JS, so it stays external and is copied into
// .pressh/node_modules. mongodb and pg also reference OPTIONAL native peers
// behind guarded requires; they aren't installed, so they're externalized too —
// the drivers already degrade gracefully without them, exactly as the
// build-from-source runtime does today.
const EXTERNAL = [
    "better-sqlite3",
    // pg optional native/runtime peers
    "pg-native",
    "pg-cloudflare",
    "cloudflare:sockets",
    // mongodb optional native peers (guarded requires)
    "kerberos",
    "@mongodb-js/zstd",
    "@mongodb-js/saslprep",
    "snappy",
    "mongodb-client-encryption",
    "@aws-sdk/credential-providers",
    "gcp-metadata",
    "socks",
    "aws4",
    "bson-ext",
];

// ESM output cannot use a bare `require`, but the bundled CJS drivers (and their
// guarded optional requires) need one. Provide a real `require` so esbuild's
// `__require` shim delegates to it instead of throwing "Dynamic require…".
const REQUIRE_BANNER = {
    js: "import{createRequire as __pressh_createRequire}from'node:module';const require=__pressh_createRequire(import.meta.url);",
};

/** Bundles a Node server entry (server.js / seed-cli.js) with its deps inlined. */
async function bundleServer(entry, outfile) {
    await build({
        entryPoints: [join(ROOT, entry)],
        outfile: join(OUT, outfile),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        external: EXTERNAL,
        banner: REQUIRE_BANNER,
        logLevel: "warning",
    });
    return outfile;
}

// The worker entry + its ESM sandbox loader run INSIDE the plugin worker and
// import only node built-ins (no CJS deps), so they need no require banner.
// They must be emitted as two separate files in the same dir, because
// worker-entry registers the loader via the literal `./sandbox-loader.js`.
async function bundleWorkerRuntime(destRuntimeDir) {
    await build({
        entryPoints: [join(ROOT, "packages/runtime/dist/worker-entry.js")],
        outfile: join(destRuntimeDir, "worker-entry.js"),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        logLevel: "warning",
    });
    await build({
        entryPoints: [join(ROOT, "packages/runtime/dist/sandbox-loader.js")],
        outfile: join(destRuntimeDir, "sandbox-loader.js"),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        logLevel: "warning",
    });
}

/** Copies only the runtime files a native dep needs (skips source/build intermediates). */
async function copyNativeDep(name, subpaths) {
    for (const sub of subpaths) {
        await cp(join(ROOT, "node_modules", name, sub), join(OUT, "node_modules", name, sub), {
            recursive: true,
        });
    }
}

async function main() {
    await rm(OUT, {recursive: true, force: true});
    await mkdir(join(OUT, "studio", "runtime"), {recursive: true});
    await mkdir(join(OUT, "site", "runtime"), {recursive: true});
    await mkdir(join(OUT, "plugins"), {recursive: true});
    await mkdir(join(OUT, "node_modules"), {recursive: true});

    // 1. Server + operator-CLI bundles (workspace deps + pg/mysql2/mongodb/hono
    //    inlined). The CLIs (backup/restore/gdpr/migrate, seed, reseed) ship so
    //    the slim image stays self-contained for `docker compose exec` ops.
    await bundleServer("apps/studio/dist/server.js", "studio/server.js");
    await bundleServer("apps/studio/dist/cli.js", "studio/cli.js");
    await bundleServer("apps/studio/dist/seed-cli.js", "studio/seed-cli.js");
    await bundleServer("apps/studio/dist/reseed-prebuilt.js", "studio/reseed-prebuilt.js");
    await bundleServer("apps/site/dist/server.js", "site/server.js");

    // 2. Plugin-worker runtime, emitted into each app's sandboxed `runtime/` dir.
    await bundleWorkerRuntime(join(OUT, "studio", "runtime"));
    await cp(join(OUT, "studio", "runtime"), join(OUT, "site", "runtime"), {recursive: true});

    // 2b. Deploy-time re-signer (sign-core + signature helpers inlined). The
    //     Docker entrypoint runs `.pressh/sign-builtins.mjs` once the master key
    //     is provisioned, re-signing the shipped builtins with the real key.
    await build({
        entryPoints: [join(ROOT, "scripts/sign-standalone.mjs")],
        outfile: join(OUT, "sign-builtins.mjs"),
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        logLevel: "warning",
    });

    // 3. Static/admin assets next to their server (resolved via import.meta.url).
    await cp(join(ROOT, "apps/studio/dist/admin-next.html"), join(OUT, "studio", "admin-next.html"));
    await cp(join(ROOT, "apps/site/dist/client"), join(OUT, "site", "client"), {recursive: true});

    // 4. Signed first-party plugins, copied verbatim (signatures stay valid).
    await cp(join(ROOT, "builtins"), join(OUT, "builtins"), {recursive: true});

    // 5. Native sqlite driver + its runtime closure (pruned to what loads).
    await copyNativeDep("better-sqlite3", ["package.json", "lib", "build/Release"]);
    await copyNativeDep("bindings", ["package.json", "bindings.js"]);
    await copyNativeDep("file-uri-to-path", ["package.json", "index.js"]);

    // 6. `type: module` so Node treats the `.js` bundles as ESM and resolves the
    //    bundled node_modules for the externalized native sqlite driver.
    await writeFile(
        join(OUT, "package.json"),
        JSON.stringify({name: "pressh-standalone", private: true, type: "module"}, null, 2) + "\n",
        "utf8",
    );

    // 6b. Two-process supervisor, for single-service hosts (e.g. Railway) that
    //     run both apps together. It self-locates the build dir, so the copy
    //     works from the bundle root. Plain ESM with no deps — copied as-is.
    await cp(join(ROOT, "scripts/run-standalone.mjs"), join(OUT, "run-standalone.mjs"));

    // 7. Drop-in folder for external plugins (mounted/copied by operators).
    await writeFile(
        join(OUT, "plugins", "README.md"),
        "# External plugins\n\n" +
        "Drop a signed plugin folder here (one dir per plugin, each with\n" +
        "`pressh.plugin.json`, its entry `.mjs`, and `pressh.signature.json`).\n" +
        "Both the Studio and Site processes load this folder at boot via\n" +
        "`PRESSH_PLUGINS_DIR`. Unsigned plugins are rejected in production.\n",
        "utf8",
    );

    console.log("Built standalone app → .pressh/");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
