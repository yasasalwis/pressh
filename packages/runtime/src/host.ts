import { Worker } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve as resolvePath, sep } from "node:path";
import { CapabilityGate, PressError } from "@pressh/core";
import type { AuditLog, Logger, Result, SecretsBackend, StorageAdapter } from "@pressh/core";
import type {
  HostToWorker,
  PluginManifest,
  RpcError,
  WorkerToHost,
} from "@pressh/sdk";
import type { CveChecker } from "./cve.js";
import type { PluginStateStore } from "./plugin-state.js";

const DEFAULT_INVOKE_TIMEOUT_MS = 5000;
const MANIFEST_FILE = "pressh.plugin.json";
const SIGNATURE_FILE = "pressh.signature.json";

/**
 * Collections that hold auth-critical data (password hashes, live session
 * tokens, invite tokens). No plugin capability — however the manifest is
 * worded — may ever reach these, since manifest capabilities are
 * self-asserted by the (untrusted) plugin author.
 */
const RESERVED_COLLECTIONS = new Set(["users", "sessions", "invites"]);

/**
 * Resolves a plugin-supplied relative path and asserts it stays inside the
 * plugin's own directory. `manifest.main`/`panel.entry` are attacker-controlled,
 * so without this a value like "../../../../etc/passwd" would let the host read
 * (or import) files anywhere on disk.
 */
function resolveWithin(baseDir: string, relative: string): string {
  const base = resolvePath(baseDir);
  const target = resolvePath(base, relative);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new PressError("forbidden", `Plugin path escapes its directory: ${relative}`);
  }
  return target;
}

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
  /** When set, plugins flagged by the CVE feed are refused at load (baseline #11). */
  cve?: CveChecker;
  /**
   * Persists the enabled set. When provided, `register` auto-starts a plugin
   * whose persisted state is enabled, and `enable`/`disable` write through. A
   * disabled plugin spawns no worker, so the app stays lean.
   */
  state?: PluginStateStore;
}

/** Installed-plugin metadata for the Studio Plugins screen. */
export interface PluginInfo {
  name: string;
  version: string;
  capabilities: string[];
  endpoints: number;
  hasPanel: boolean;
  /** True when a worker is currently running for this plugin. */
  enabled: boolean;
  /** True for first-party plugins shipped with Pressh (cannot be uninstalled). */
  builtin: boolean;
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

interface PluginRecord {
  dir: string;
  manifest: PluginManifest;
  builtin: boolean;
  /** Non-null only while a worker is running (i.e. the plugin is enabled). */
  instance: PluginInstance | null;
}

export class PluginHost {
  readonly #opts: PluginHostOptions;
  readonly #gate = new CapabilityGate();
  readonly #workerScript: string;
  readonly #timeout: number;
  readonly #registry = new Map<string, PluginRecord>();

  constructor(opts: PluginHostOptions) {
    this.#opts = opts;
    this.#timeout = opts.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
    this.#workerScript = opts.workerScript ?? fileURLToPath(new URL("./worker-entry.js", import.meta.url));
  }

  /**
   * Validates a plugin (manifest, signature, CVE feed) and registers it WITHOUT
   * spawning a worker. If a state store reports it as enabled, it is started.
   * This is how both processes discover plugins at boot: disabled ones cost
   * nothing beyond the metadata read.
   */
  async register(pluginDir: string, opts: { builtin?: boolean } = {}): Promise<PluginManifest> {
    const manifest = await this.#readManifest(pluginDir);
    await this.#verifySignature(pluginDir, manifest);
    if (this.#opts.cve && (await this.#opts.cve.isFlagged(manifest.name, manifest.version))) {
      throw new PressError(
        "forbidden",
        `Plugin "${manifest.name}@${manifest.version}" has a known vulnerability and was refused`,
      );
    }
    const record: PluginRecord = { dir: pluginDir, manifest, builtin: opts.builtin ?? false, instance: null };
    this.#registry.set(manifest.name, record);
    if (this.#opts.state && (await this.#opts.state.isEnabled(manifest.name))) {
      record.instance = await this.#spawn(record.dir, record.manifest);
    }
    return manifest;
  }

  /** Registers and immediately starts a plugin (used by tests and one-shot loads). */
  async load(pluginDir: string, opts: { builtin?: boolean } = {}): Promise<PluginManifest> {
    const manifest = await this.register(pluginDir, opts);
    await this.enable(manifest.name);
    return manifest;
  }

  /** Spawns the worker for a registered plugin and persists the enabled state. Idempotent. */
  async enable(name: string): Promise<void> {
    const record = this.#registry.get(name);
    if (!record) throw new PressError("not_found", `Plugin not registered: ${name}`);
    if (!record.instance) {
      record.instance = await this.#spawn(record.dir, record.manifest);
    }
    await this.#opts.state?.setEnabled(name, true);
  }

  /** Terminates the worker (zero footprint) and persists the disabled state. Idempotent. */
  async disable(name: string): Promise<void> {
    const record = this.#registry.get(name);
    if (!record) return;
    if (record.instance) {
      await record.instance.terminate();
      record.instance = null;
    }
    await this.#opts.state?.setEnabled(name, false);
  }

  /** True only while a worker is running for the plugin (registered AND enabled). */
  has(name: string): boolean {
    return this.#registry.get(name)?.instance != null;
  }

  /** True when the plugin is known to the host, regardless of enabled state. */
  isRegistered(name: string): boolean {
    return this.#registry.has(name);
  }

  /** Handler names the plugin's panel may invoke (default-deny allowlist). */
  panelActions(name: string): string[] {
    return this.#registry.get(name)?.manifest.panelActions ?? [];
  }

  endpoints(): LoadedEndpoint[] {
    const out: LoadedEndpoint[] = [];
    for (const [, record] of this.#registry) {
      if (!record.instance) continue; // disabled plugins serve no endpoints
      for (const ep of record.manifest.endpoints ?? []) {
        out.push({ plugin: record.manifest.name, method: ep.method, path: ep.path, handler: ep.handler });
      }
    }
    return out;
  }

  /** All registered plugins with their state, for the Studio Plugins screen. */
  plugins(): PluginInfo[] {
    const out: PluginInfo[] = [];
    for (const [, record] of this.#registry) {
      out.push({
        name: record.manifest.name,
        version: record.manifest.version,
        capabilities: record.manifest.capabilities ?? [],
        endpoints: (record.manifest.endpoints ?? []).length,
        hasPanel: Boolean(record.manifest.panel),
        enabled: record.instance != null,
        builtin: record.builtin,
      });
    }
    return out;
  }

  /** Enabled plugins that declare an admin panel, for the Studio panel list. */
  panels(): { plugin: string; title: string }[] {
    const out: { plugin: string; title: string }[] = [];
    for (const [, record] of this.#registry) {
      if (record.instance && record.manifest.panel) {
        out.push({ plugin: record.manifest.name, title: record.manifest.panel.title });
      }
    }
    return out;
  }

  /** Reads an enabled plugin's admin panel HTML (served into a sandboxed iframe). */
  async panel(name: string): Promise<{ title: string; html: string } | null> {
    const record = this.#registry.get(name);
    if (!record || !record.instance || !record.manifest.panel) return null;
    const html = await readFile(resolveWithin(record.dir, record.manifest.panel.entry), "utf8");
    return { title: record.manifest.panel.title, html };
  }

  async invoke(name: string, method: string, args: unknown): Promise<unknown> {
    const record = this.#registry.get(name);
    if (!record || !record.instance) throw new PressError("not_found", `Plugin not enabled: ${name}`);
    const instance = record.instance;
    try {
      return await instance.invoke(method, args, this.#timeout);
    } catch (e) {
      if (isTimeout(e)) {
        // Kill the (possibly wedged) worker and respawn so the next call works.
        await instance.terminate().catch(() => undefined);
        record.instance = await this.#spawn(record.dir, record.manifest);
      }
      throw e;
    }
  }

  async stop(name: string): Promise<void> {
    const record = this.#registry.get(name);
    if (!record) return;
    if (record.instance) await record.instance.terminate();
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
    await instance.start(resolveWithin(pluginDir, manifest.main));
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

    const content = await readFile(resolveWithin(dir, manifest.main));
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
      if (method === "list") {
        // Read-only collection enumeration for the data browser. Gated behind
        // the broad `storage.read:*` grant — there is no raw-query escape hatch
        // (baseline #14): a plugin can list and read, never run SQL or write.
        this.#gate.assert(caps, "storage.read:*");
        return unwrap(await this.#opts.storage.listCollections());
      }
      const collection = String(args[0]);
      // Auth-critical collections are off-limits to plugins regardless of their
      // self-asserted capabilities (no `storage.read:*` / `storage.write:users`
      // can reach password hashes, session tokens, or invite tokens).
      if (RESERVED_COLLECTIONS.has(collection)) {
        throw new PressError("capability_denied", `Capability denied: ${collection} is reserved`, {
          required: `storage:${collection}`,
        });
      }
      if (method === "get") {
        this.#gate.assert(caps, `storage.read:${collection}`);
        return unwrap(await this.#opts.storage.get(collection, String(args[1])));
      }
      if (method === "put") {
        this.#gate.assert(caps, `storage.write:${collection}`);
        const doc = args[1] as { id: string; [key: string]: unknown };
        return unwrap(await this.#opts.storage.put(collection, doc));
      }
      if (method === "delete") {
        this.#gate.assert(caps, `storage.write:${collection}`);
        return unwrap(await this.#opts.storage.delete(collection, String(args[1])));
      }
      if (method === "query") {
        this.#gate.assert(caps, `storage.read:${collection}`);
        const where = args[1] as Record<string, string | number | boolean> | undefined;
        const cursor = args[2] as { limit?: number; after?: string | null } | undefined;
        const page = unwrap(
          await this.#opts.storage.query(collection, where ? { where } : {}, cursor ?? {}),
        );
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
