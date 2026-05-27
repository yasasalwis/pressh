#!/usr/bin/env node
// Runs the standalone `.pressh/` build (produced by `npm run build`) — the
// production counterpart to `scripts/run.mjs`, which runs the dev `tsc` output.
// Spawns the Studio (admin) and Site (public) as two processes, preserving the
// trust-boundary split (ADR-002), each pointed at its bundled server plus the
// shared builtins/external-plugins dirs and its own sandboxed worker runtime.
// Forwards termination signals; respawns a single process on the storage-cutover
// exit code (matching run.mjs's supervisor behaviour).
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {fileURLToPath} from "node:url";
import {existsSync} from "node:fs";

// Keep in sync with STORAGE_RESTART_EXIT_CODE in apps/{studio,site}/src/server.ts.
const STORAGE_RESTART_EXIT_CODE = 75;

// The build dir is wherever the studio/site bundles live. In the repo this
// script sits in scripts/ (→ ../.pressh/); in the standalone build a copy sits at
// the build root (→ ./, i.e. .pressh/ locally or /app in the slim image). Detect
// by probing for studio/server.js next to this script.
const HERE = new URL("./", import.meta.url);
const DIST = existsSync(fileURLToPath(new URL("studio/server.js", HERE)))
    ? HERE
    : new URL("../.pressh/", import.meta.url);
const builtinsDir = fileURLToPath(new URL("builtins", DIST));
const pluginsDir = fileURLToPath(new URL("plugins", DIST));

/** Per-service env: each app loads the SAME builtins/external plugins, but its
 * worker runs from its OWN `runtime/` dir so the sandbox fs-read grant stays
 * scoped to that code-only directory (see scripts/bundle.mjs). */
function serviceEnv(name) {
    return {
        PRESSH_BUILTINS_DIR: builtinsDir,
        PRESSH_PLUGINS_DIR: pluginsDir,
        PRESSH_WORKER_SCRIPT: fileURLToPath(new URL(`${name}/runtime/worker-entry.js`, DIST)),
    };
}

const services = [
    {name: "studio", color: "\x1b[36m", entry: new URL("studio/server.js", DIST)},
    {name: "site", color: "\x1b[35m", entry: new URL("site/server.js", DIST)},
];

const reset = "\x1b[0m";
const useColor = process.stdout.isTTY;
/** service.name → live ChildProcess. */
const children = new Map();
let shuttingDown = false;

function label(service) {
    const tag = `[${service.name}]`;
    return useColor ? `${service.color}${tag}${reset}` : tag;
}

function pipeWithPrefix(service, stream, sink) {
    createInterface({input: stream}).on("line", (line) => {
        sink.write(`${label(service)} ${line}\n`);
    });
}

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children.values()) {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
}

function allStopped() {
    for (const child of children.values()) {
        if (child.exitCode === null && child.signalCode === null) return false;
    }
    return true;
}

function startService(service) {
    const child = spawn(process.execPath, [fileURLToPath(service.entry)], {
        stdio: ["inherit", "pipe", "pipe"],
        env: {...process.env, ...serviceEnv(service.name)},
    });
    children.set(service.name, child);

    pipeWithPrefix(service, child.stdout, process.stdout);
    pipeWithPrefix(service, child.stderr, process.stderr);

    child.on("exit", (code, signal) => {
        if (shuttingDown) {
            if (allStopped()) process.exit(0);
            return;
        }
        if (code === STORAGE_RESTART_EXIT_CODE) {
            process.stdout.write(`${label(service)} restarting on the new database…\n`);
            startService(service);
            return;
        }
        const how = signal ? `signal ${signal}` : `code ${code}`;
        process.stderr.write(`${label(service)} exited (${how}) — shutting down the other process.\n`);
        shutdown("SIGTERM");
        if (allStopped()) process.exit(code ?? (signal ? 1 : 0));
    });

    child.on("error", (err) => {
        process.stderr.write(`${label(service)} failed to start: ${err.message}\n`);
        shutdown("SIGTERM");
        process.exitCode = 1;
    });
}

if (!existsSync(fileURLToPath(services[0].entry))) {
    process.stderr.write("No .pressh/ build found — run `npm run build` first.\n");
    process.exit(1);
}

for (const service of services) startService(service);

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => shutdown(signal));
}
