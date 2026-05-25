#!/usr/bin/env node
// Launches the Studio (admin) and Site (public) as two separate processes —
// preserving the two-process trust boundary (ADR-002) rather than sharing one
// runtime. Prefixes each app's output and forwards termination signals.
//
// A Database-Manager cutover makes a process exit with STORAGE_RESTART_EXIT_CODE
// to be restarted on the new backend. Acting as the supervisor in dev, we
// respawn just that process; any OTHER exit tears the pair down together.
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {fileURLToPath} from "node:url";

// Keep in sync with the constant in apps/{studio,site}/src/server.ts.
const STORAGE_RESTART_EXIT_CODE = 75;

const services = [
  { name: "studio", color: "\x1b[36m", entry: new URL("../apps/studio/dist/server.js", import.meta.url) },
  { name: "site", color: "\x1b[35m", entry: new URL("../apps/site/dist/server.js", import.meta.url) },
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
  createInterface({ input: stream }).on("line", (line) => {
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
    env: process.env,
  });
    children.set(service.name, child);

  pipeWithPrefix(service, child.stdout, process.stdout);
  pipeWithPrefix(service, child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
      if (shuttingDown) {
          if (allStopped()) process.exit(0);
          return;
      }
      // Cutover restart: respawn just this service on the new backend.
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

for (const service of services) startService(service);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}
