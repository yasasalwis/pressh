import { Worker } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CapabilityGate, PressError } from "@pressh/core";
import type { AuditLog, Logger, Result, SecretsBackend, StorageAdapter } from "@pressh/core";
import type {
  HostToWorker,
  PluginManifest,
  RpcError,
  WorkerToHost,
} from "@pressh/sdk";

const DEFAULT_INVOKE_TIMEOUT_MS = 5000;
const MANIFEST_FILE = "pressh.plugin.json";
const SIGNATURE_FILE = "pressh.signature.json";

export interface PluginHostOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  secrets?: SecretsBackend;
  logger?: Logger;
  /** Production sets this false: unsigned/invalid plugins are refused (ADR-011). */
  allowUnsigned?: boolean;
  invokeTimeoutMs?: number;
  /** Override the compiled worker script (used in tests running from src). */
  workerScript?: string;
  maxMemoryMb?: number;
}

export interface LoadedEndpoint {
  plugin: string;
  method: string;
  path: string;
  handler: string;
}

type ServiceResponse = { ok: true; value: unknown } | { ok: false; error: RpcError };

type ServiceCallMessage = Extract<WorkerToHost, { kind: "service-call" }>;
type ServiceHandler = (manifest: PluginManifest, msg: ServiceCallMessage) => Promise<ServiceResponse>;

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function isTimeout(error: unknown): boolean {
  return error instanceof PressError && error.detail?.["timeout"] === true;
}

/** A single plugin running in its own worker thread. */
class PluginInstance {
  readonly manifest: PluginManifest;
  readonly #worker: Worker;
  readonly #onService: ServiceHandler;
  readonly #logger: Logger | undefined;
  #nextId = 1;
  readonly #pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  #readyResolve: (() => void) | undefined;
  #readyReject: ((e: Error) => void) | undefined;

  constructor(
    manifest: PluginManifest,
    worker: Worker,
    onService: ServiceHandler,
    logger: Logger | undefined,
  ) {
    this.manifest = manifest;
    this.#worker = worker;
    this.#onService = onService;
    this.#logger = logger;
    this.#worker.on("message", (msg: WorkerToHost) => this.#onMessage(msg));
    this.#worker.on("error", (err) => this.#fail(err));
    this.#worker.on("exit", () => this.#fail(new PressError("internal", "Worker exited")));
  }

  start(pluginPath: string): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });
    this.#send({ kind: "init", manifest: this.manifest, pluginPath });
    return ready;
  }

  invoke(method: string, args: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new PressError("internal", `Plugin "${this.manifest.name}" timed out`, { timeout: true }),
        );
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#send({ kind: "invoke", id, method, args });
    });
  }

  async terminate(): Promise<void> {
    for (const [, pending] of this.#pending) clearTimeout(pending.timer);
    this.#pending.clear();
    await this.#worker.terminate();
  }

  #send(message: HostToWorker): void {
    this.#worker.postMessage(message);
  }

  #fail(error: Error): void {
    this.#readyReject?.(error);
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #onMessage(message: WorkerToHost): void {
    switch (message.kind) {
      case "ready":
        this.#readyResolve?.();
        return;
      case "error":
        this.#readyReject?.(new PressError("internal", message.message));
        return;
      case "log":
        this.#logger?.[message.level](message.message, message.fields);
        return;
      case "invoke-result": {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(message.id);
        if (message.ok) pending.resolve(message.value);
        else {
          const error = new PressError(
            (message.error.code as PressError["code"]) ?? "internal",
            message.error.message,
          );
          pending.reject(error);
        }
        return;
      }
      case "service-call":
        void this.#handleService(message);
        return;
    }
  }

  async #handleService(message: Extract<WorkerToHost, { kind: "service-call" }>): Promise<void> {
    const response = await this.#onService(this.manifest, message);
    if (response.ok) {
      this.#send({ kind: "service-result", id: message.id, ok: true, value: response.value });
    } else {
      this.#send({ kind: "service-result", id: message.id, ok: false, error: response.error });
    }
  }
}

export class PluginHost {
  readonly #opts: PluginHostOptions;
  readonly #gate = new CapabilityGate();
  readonly #workerScript: string;
  readonly #timeout: number;
  readonly #registry = new Map<string, { dir: string; manifest: PluginManifest; instance: PluginInstance }>();

  constructor(opts: PluginHostOptions) {
    this.#opts = opts;
    this.#timeout = opts.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
    this.#workerScript = opts.workerScript ?? fileURLToPath(new URL("./worker-entry.js", import.meta.url));
  }

  async load(pluginDir: string): Promise<PluginManifest> {
    const manifest = await this.#readManifest(pluginDir);
    await this.#verifySignature(pluginDir, manifest);
    const instance = await this.#spawn(pluginDir, manifest);
    this.#registry.set(manifest.name, { dir: pluginDir, manifest, instance });
    return manifest;
  }

  has(name: string): boolean {
    return this.#registry.has(name);
  }

  endpoints(): LoadedEndpoint[] {
    const out: LoadedEndpoint[] = [];
    for (const [, record] of this.#registry) {
      for (const ep of record.manifest.endpoints ?? []) {
        out.push({ plugin: record.manifest.name, method: ep.method, path: ep.path, handler: ep.handler });
      }
    }
    return out;
  }

  async invoke(name: string, method: string, args: unknown): Promise<unknown> {
    const record = this.#registry.get(name);
    if (!record) throw new PressError("not_found", `Plugin not loaded: ${name}`);
    try {
      return await record.instance.invoke(method, args, this.#timeout);
    } catch (e) {
      if (isTimeout(e)) {
        // Kill the (possibly wedged) worker and respawn so the next call works.
        await record.instance.terminate().catch(() => undefined);
        record.instance = await this.#spawn(record.dir, record.manifest);
      }
      throw e;
    }
  }

  async stop(name: string): Promise<void> {
    const record = this.#registry.get(name);
    if (!record) return;
    await record.instance.terminate();
    this.#registry.delete(name);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#registry.keys()].map((name) => this.stop(name)));
  }

  async #spawn(pluginDir: string, manifest: PluginManifest): Promise<PluginInstance> {
    const worker = new Worker(this.#workerScript, {
      env: {},
      ...(this.#opts.maxMemoryMb
        ? { resourceLimits: { maxOldGenerationSizeMb: this.#opts.maxMemoryMb } }
        : {}),
    });
    const instance = new PluginInstance(
      manifest,
      worker,
      (m, msg) => this.#handleServiceCall(m, msg),
      this.#opts.logger,
    );
    await instance.start(join(pluginDir, manifest.main));
    return instance;
  }

  async #readManifest(dir: string): Promise<PluginManifest> {
    let parsed: PluginManifest;
    try {
      parsed = JSON.parse(await readFile(join(dir, MANIFEST_FILE), "utf8")) as PluginManifest;
    } catch {
      throw new PressError("not_found", `Plugin manifest not found in ${dir}`);
    }
    if (!parsed.name || !parsed.version || !parsed.main || !Array.isArray(parsed.capabilities)) {
      throw new PressError("validation", "Invalid plugin manifest");
    }
    return parsed;
  }

  async #verifySignature(dir: string, manifest: PluginManifest): Promise<void> {
    let signature: { algorithm?: string; hash?: string } | null = null;
    try {
      signature = JSON.parse(await readFile(join(dir, SIGNATURE_FILE), "utf8")) as {
        algorithm?: string;
        hash?: string;
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new PressError("forbidden", `Unreadable signature for "${manifest.name}"`);
      }
      signature = null;
    }

    if (!signature || !signature.hash) {
      if (this.#opts.allowUnsigned) return;
      throw new PressError("forbidden", `Plugin "${manifest.name}" is unsigned`);
    }

    const content = await readFile(join(dir, manifest.main));
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== signature.hash) {
      throw new PressError("forbidden", `Plugin "${manifest.name}" failed signature verification`);
    }
  }

  async #handleServiceCall(
    manifest: PluginManifest,
    message: Extract<WorkerToHost, { kind: "service-call" }>,
  ): Promise<ServiceResponse> {
    try {
      const value = await this.#dispatchService(manifest, message);
      return { ok: true, value };
    } catch (e) {
      const error = e instanceof PressError ? e : new PressError("internal", String(e));
      if (error.code === "capability_denied") {
        await this.#opts.audit.append({
          action: "plugin.capability_denied",
          actorId: manifest.name,
          detail: { service: message.service, method: message.method, error: error.message },
        });
      }
      return { ok: false, error: { code: error.code, message: error.message } };
    }
  }

  async #dispatchService(
    manifest: PluginManifest,
    message: Extract<WorkerToHost, { kind: "service-call" }>,
  ): Promise<unknown> {
    const caps = manifest.capabilities;
    const { service, method, args } = message;

    if (service === "storage") {
      const collection = String(args[0]);
      if (method === "get") {
        this.#gate.assert(caps, `storage.read:${collection}`);
        return unwrap(await this.#opts.storage.get(collection, String(args[1])));
      }
      if (method === "put") {
        this.#gate.assert(caps, `storage.write:${collection}`);
        const doc = args[1] as { id: string; [key: string]: unknown };
        return unwrap(await this.#opts.storage.put(collection, doc));
      }
      if (method === "query") {
        this.#gate.assert(caps, `storage.read:${collection}`);
        const where = args[1] as Record<string, string | number | boolean> | undefined;
        const page = unwrap(await this.#opts.storage.query(collection, where ? { where } : {}));
        return { items: page.items, nextCursor: page.nextCursor };
      }
    }

    if (service === "secrets" && method === "get") {
      const name = String(args[0]);
      this.#gate.assert(caps, `secrets.read:${name}`);
      if (!this.#opts.secrets) throw new PressError("internal", "Secrets backend not configured");
      return this.#opts.secrets.getSecret(name);
    }

    throw new PressError("validation", `Unknown service: ${service}.${method}`);
  }
}
