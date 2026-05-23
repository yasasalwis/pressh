#!/usr/bin/env node
// Launches the Studio (admin) and Site (public) as two separate processes —
// preserving the two-process trust boundary (ADR-002) rather than sharing one
// runtime. Prefixes each app's output, forwards termination signals, and shuts
// the pair down together if either exits.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const services = [
  { name: "studio", color: "\x1b[36m", entry: new URL("../apps/studio/dist/server.js", import.meta.url) },
  { name: "site", color: "\x1b[35m", entry: new URL("../apps/site/dist/server.js", import.meta.url) },
];

const reset = "\x1b[0m";
const useColor = process.stdout.isTTY;
const children = [];
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
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
}

for (const service of services) {
  const child = spawn(process.execPath, [fileURLToPath(service.entry)], {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });
  children.push(child);

  pipeWithPrefix(service, child.stdout, process.stdout);
  pipeWithPrefix(service, child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      const how = signal ? `signal ${signal}` : `code ${code}`;
      process.stderr.write(`${label(service)} exited (${how}) — shutting down the other process.\n`);
      shutdown("SIGTERM");
    }
    if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) {
      process.exit(code ?? (signal ? 1 : 0));
    }
  });

  child.on("error", (err) => {
    process.stderr.write(`${label(service)} failed to start: ${err.message}\n`);
    shutdown("SIGTERM");
    process.exitCode = 1;
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}
