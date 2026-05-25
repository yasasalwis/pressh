import { parentPort } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import type {
  HostApi,
  HostToWorker,
  PluginModule,
  WorkerToHost,
} from "@pressh/sdk";

/**
 * The script that runs INSIDE each plugin worker thread. It owns no host state;
 * its only channel to the host is `parentPort` RPC. Plugin handlers receive a
 * `HostApi` whose every method round-trips to the host, where it is
 * capability-checked (ADR-003/004).
 */

// Defense-in-depth: even though the worker is spawned with an empty env, scrub
// process.env so a plugin can never read host secrets via process.env.
for (const key of Object.keys(process.env)) delete process.env[key];

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

function serviceCall(service: "storage" | "secrets", method: string, args: unknown[]): Promise<unknown> {
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
