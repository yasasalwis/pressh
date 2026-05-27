// `parentPort` and `register` are imported (and bound) BEFORE the sandbox
// loader is installed, so blocking `node:worker_threads`/`node:module` for the
// plugin below does not break the worker's own RPC channel.
import {parentPort, workerData} from "node:worker_threads";
import {register} from "node:module";
import {pathToFileURL} from "node:url";
import type {HostApi, HostToWorker, PluginModule, WorkerToHost,} from "@pressh/sdk";

/**
 * The script that runs INSIDE each plugin worker thread. It owns no host state;
 * its only channel to the host is `parentPort` RPC. Plugin handlers receive a
 * `HostApi` whose every method round-trips to the host, where it is
 * capability-checked (ADR-003/004).
 *
 * Isolation is layered (see SECURITY baseline #1):
 *  1. The host spawns this worker under the Node permission model
 *     (`--permission`, fs-read scoped to the plugin dir), denying the
 *     filesystem, child_process, native addons and sub-workers at the OS level.
 *  2. The sandbox loader (registered below) denies I/O-capable builtins the
 *     permission model misses — chiefly the network (`node:net`/`http`/`dns`).
 *  3. Powerful globals are scrubbed so a plugin cannot reach them indirectly.
 */

// Layer 2: only pure-computation builtins and the plugin's own files may be
// imported; network/process/fs builtins and npm deps are denied. The plugin's
// own directory (passed by the host) confines file/relative/absolute imports so
// the plugin cannot reach host/runtime files even under a broad fs-read grant.
const pluginRoot =
    workerData && typeof workerData === "object" && typeof (workerData as {
        pluginRoot?: unknown
    }).pluginRoot === "string"
        ? (workerData as { pluginRoot: string }).pluginRoot
        : "";
register("./sandbox-loader.js", import.meta.url, {data: {pluginRoot}});

// Layer 3: scrub process.env (host secrets) and the most dangerous globals.
// `fetch`/`WebSocket` are network egress the import allowlist cannot see; the
// low-level `process` escape hatches could rebuild blocked capabilities.
for (const key of Object.keys(process.env)) delete process.env[key];
delete (globalThis as { fetch?: unknown }).fetch;
delete (globalThis as { WebSocket?: unknown }).WebSocket;
delete (globalThis as { EventSource?: unknown }).EventSource;
const proc = process as unknown as { binding?: unknown; dlopen?: unknown; _linkedBinding?: unknown };
delete proc.binding;
delete proc.dlopen;
delete proc._linkedBinding;

const port = parentPort;
if (!port) {
  throw new Error("worker-entry must be run as a worker thread");
}

const post = (message: WorkerToHost): void => {
  port.postMessage(message);
};

let nextServiceId = 1;
const pendingService = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function serviceCall(
    service: "storage" | "secrets" | "pii",
    method: string,
    args: unknown[],
): Promise<unknown> {
  const id = nextServiceId++;
  return new Promise((resolve, reject) => {
    pendingService.set(id, { resolve, reject });
    post({ kind: "service-call", id, service, method, args });
  });
}

const host: HostApi = {
  log: (level, message, fields) => post({ kind: "log", level, message, fields: fields ?? {} }),
  storage: {
    get: (collection, id) => serviceCall("storage", "get", [collection, id]),
    put: (collection, doc) => serviceCall("storage", "put", [collection, doc]).then(() => undefined),
    delete: (collection, id) => serviceCall("storage", "delete", [collection, id]).then(() => undefined),
    query: (collection, where, page) =>
      serviceCall("storage", "query", [collection, where, page]) as Promise<{
        items: unknown[];
        nextCursor: string | null;
      }>,
    list: () => serviceCall("storage", "list", []) as Promise<string[]>,
  },
  secrets: {
    get: (name) => serviceCall("secrets", "get", [name]) as Promise<string>,
  },
    pii: {
        protect: (subjectRef, value) =>
            serviceCall("pii", "protect", [subjectRef, value]) as Promise<{ $enc: string }>,
        recordConsent: (subjectRef, scope, granted) =>
            serviceCall("pii", "recordConsent", [subjectRef, scope, granted]).then(() => undefined),
    },
};

let pluginModule: PluginModule | null = null;

port.on("message", (raw: HostToWorker) => {
  void handle(raw);
});

async function handle(message: HostToWorker): Promise<void> {
  switch (message.kind) {
    case "init": {
      try {
        const mod = (await import(pathToFileURL(message.pluginPath).href)) as PluginModule;
        pluginModule = mod;
        post({ kind: "ready" });
      } catch (e) {
        post({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    case "service-result": {
      const pending = pendingService.get(message.id);
      if (!pending) return;
      pendingService.delete(message.id);
      if (message.ok) {
        pending.resolve(message.value);
      } else {
        const error = new Error(message.error.message);
        (error as Error & { code?: string }).code = message.error.code;
        pending.reject(error);
      }
      return;
    }
    case "invoke": {
      const handler = pluginModule?.[message.method];
      if (typeof handler !== "function") {
        post({
          kind: "invoke-result",
          id: message.id,
          ok: false,
          error: { code: "not_found", message: `No handler: ${message.method}` },
        });
        return;
      }
      try {
        const value = await handler(message.args, host);
        post({ kind: "invoke-result", id: message.id, ok: true, value });
      } catch (e) {
        post({
          kind: "invoke-result",
          id: message.id,
          ok: false,
          error: { code: "internal", message: e instanceof Error ? e.message : String(e) },
        });
      }
      return;
    }
  }
}
