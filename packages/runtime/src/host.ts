import {Worker} from "node:worker_threads";
import {readFile} from "node:fs/promises";
import {realpathSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join, resolve as resolvePath, sep} from "node:path";
import type {AuditLog, Logger, Result, SecretsBackend, StorageAdapter} from "@pressh/core";
import {CapabilityGate, PressError} from "@pressh/core";
import type {DesignerPreset, HostToWorker, PluginManifest, RpcError, WorkerToHost,} from "@pressh/sdk";
import type {CveChecker} from "./cve.js";
import type {PluginStateStore} from "./plugin-state.js";
import {
  derivePluginSigningKey,
  type PluginSignature,
  SIGNATURE_FILE,
  verifyPluginSignature,
} from "./plugin-signature.js";

const DEFAULT_INVOKE_TIMEOUT_MS = 5000;
// Per-plugin worker heap cap. Lower than V8's multi-GB default so a handful of
// enabled plugins still fit a small VM (a busy plugin GCs at 64MB instead of
// ballooning until the kernel OOM-kills the whole process). Override per
// deployment with PRESSH_PLUGIN_MAX_MEMORY_MB.
const DEFAULT_MAX_MEMORY_MB = 64;
// Young-generation (scavenge) cap per worker. RPC handlers aren't allocation
// hot-loops, so a small young gen trims resident memory at negligible GC cost.
const DEFAULT_MAX_YOUNG_MB = 8;
// Tear a plugin's worker down after this long with no invocation, reclaiming its
// memory while leaving the plugin ENABLED — the next call re-spawns it (and
// re-verifies its signature). 0 disables idle teardown (always-on workers).
// Override with PRESSH_PLUGIN_IDLE_MS.
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;
const MANIFEST_FILE = "pressh.plugin.json";

/** Parses a non-negative integer env var; returns undefined when unset/invalid. */
function envInt(name: string): number | undefined {
    const raw = process.env[name];
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/**
 * The Node permission model is the OS-level half of the plugin sandbox. It is
 * available on Node ≥20; we feature-detect rather than assume so the host still
 * boots on older runtimes (the import-allowlist loader + global scrub remain
 * active there as a weaker, JS-level fallback).
 */
const PERMISSION_MODEL_SUPPORTED = process.allowedNodeEnvironmentFlags.has("--permission");

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

/**
 * Host-side privacy backend exposed to plugins as `host.pii.*` (gated). Kept as a
 * structural interface so the runtime stays decoupled from the engine — the
 * engine's GdprService satisfies it. `protect` seals under the subject namespace
 * (so GDPR erase crypto-shreds it); there is intentionally no reveal.
 */
export interface PluginPiiService {
    protect(subjectRef: string, value: string): Promise<{ $enc: string }>;

    recordConsent(subjectRef: string, scope: string, granted: boolean): Promise<void>;
}

export interface PluginHostOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  secrets?: SecretsBackend;
    /** Backs the gated `host.pii.protect` / `host.pii.recordConsent` plugin RPCs. */
    pii?: PluginPiiService;
  logger?: Logger;
  /** Production sets this false: unsigned/invalid plugins are refused (ADR-011). */
  allowUnsigned?: boolean;
    /**
     * Secret used to derive the plugin-signing HMAC key (typically
     * `PRESSH_MASTER_KEY`). Required to verify signed plugins; when absent and
     * `allowUnsigned` is false, every plugin is refused (fail-closed).
     */
    signingSecret?: string;
  invokeTimeoutMs?: number;
  /** Override the compiled worker script (used in tests running from src). */
  workerScript?: string;
    /** Per-worker old-generation heap cap (MB). Defaults to PRESSH_PLUGIN_MAX_MEMORY_MB or 64. */
  maxMemoryMb?: number;
    /**
     * Idle timeout (ms) after which an enabled plugin's worker is torn down to
     * reclaim memory; the next invoke re-spawns it. Defaults to
     * PRESSH_PLUGIN_IDLE_MS or 5 minutes. 0 keeps workers running indefinitely.
     */
    idleTimeoutMs?: number;
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

/**
 * Validates plugin-supplied designer presets. Only the top-level shape is
 * checked here and ids are namespaced to the plugin; the `template` nodes are
 * validated/escaped downstream by the engine renderer (no inline style/script
 * can survive), so a malformed node renders inert rather than dangerous.
 */
function sanitizePresets(plugin: string, parsed: unknown): DesignerPreset[] {
  if (!Array.isArray(parsed)) return [];
  const out: DesignerPreset[] = [];
  for (const p of parsed.slice(0, 100)) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const id = typeof r["id"] === "string" ? r["id"] : "";
    const name = typeof r["name"] === "string" ? r["name"] : "";
    const template = Array.isArray(r["template"]) ? r["template"] : null;
    if (!id || !name || !template) continue;
    out.push({
      id: `${plugin}:${id}`,
      name: name.slice(0, 80),
      icon: typeof r["icon"] === "string" ? (r["icon"] as string).slice(0, 8) : "🧩",
      category: typeof r["category"] === "string" && r["category"] ? (r["category"] as string).slice(0, 40) : "Plugin",
      description: typeof r["description"] === "string" ? (r["description"] as string).slice(0, 200) : "",
      template,
    });
  }
  return out;
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
    /** Operator's persisted intent: does this plugin serve requests? Independent of
     * whether a worker is currently spawned (workers are lazy + idle-reclaimed). */
    enabled: boolean;
    /** Non-null only while a worker is actually running. An enabled plugin may have
     * a null instance before its first invoke or after an idle teardown. */
  instance: PluginInstance | null;
    /** In-flight spawn shared by concurrent invokes so only one worker is created. */
    spawning: Promise<PluginInstance> | null;
    /** Outstanding invocations; the idle timer only arms once this hits zero. */
    inflight: number;
    /** Fires after the idle timeout to terminate an idle worker. */
    idleTimer: ReturnType<typeof setTimeout> | null;
  /** Designer presets the plugin contributes (loaded at register; may be empty). */
  presets: DesignerPreset[];
}

export class PluginHost {
  readonly #opts: PluginHostOptions;
  readonly #gate = new CapabilityGate();
  readonly #workerScript: string;
  readonly #timeout: number;
    readonly #maxMemoryMb: number;
    readonly #maxYoungMb: number;
    readonly #idleMs: number;
    readonly #signingKey: Buffer | null;
  readonly #registry = new Map<string, PluginRecord>();

  constructor(opts: PluginHostOptions) {
      // Defense-in-depth: even if a caller wires `allowUnsigned` true, never let it
      // stand in production — that would disable signature verification for the
      // whole host (ADR-011). Fail loud at construction rather than silently run
      // unsigned plugins in a live deployment.
      if (opts.allowUnsigned && process.env["NODE_ENV"] === "production") {
          throw new PressError(
              "forbidden",
              "allowUnsigned must not be enabled in production — unsigned plugins are refused.",
          );
      }
    this.#opts = opts;
    this.#timeout = opts.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
      this.#maxMemoryMb = opts.maxMemoryMb ?? envInt("PRESSH_PLUGIN_MAX_MEMORY_MB") ?? DEFAULT_MAX_MEMORY_MB;
      this.#maxYoungMb = DEFAULT_MAX_YOUNG_MB;
      this.#idleMs = opts.idleTimeoutMs ?? envInt("PRESSH_PLUGIN_IDLE_MS") ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.#workerScript = opts.workerScript ?? fileURLToPath(new URL("./worker-entry.js", import.meta.url));
      this.#signingKey = opts.signingSecret ? derivePluginSigningKey(opts.signingSecret) : null;
  }

  /**
   * Validates a plugin (manifest, signature, CVE feed) and registers it WITHOUT
   * spawning a worker. A plugin the state store reports as enabled is marked
   * enabled but its worker is spawned LAZILY on first invoke — so boot carries
   * zero plugin workers and an enabled-but-unused plugin costs nothing until it
   * is actually hit. Disabled plugins cost only the metadata read.
   */
  async register(pluginDir: string, opts: { builtin?: boolean } = {}): Promise<PluginManifest> {
    const manifest = await this.#readManifest(pluginDir);
      await this.#validate(pluginDir, manifest);
      const enabled = this.#opts.state ? await this.#opts.state.isEnabled(manifest.name) : false;
    const record: PluginRecord = {
      dir: pluginDir,
      manifest,
      builtin: opts.builtin ?? false,
        enabled,
      instance: null,
        spawning: null,
        inflight: 0,
        idleTimer: null,
      presets: await this.#loadPresets(pluginDir, manifest),
    };
    this.#registry.set(manifest.name, record);
    return manifest;
  }

  /** Registers and immediately starts a plugin (used by tests and one-shot loads). */
  async load(pluginDir: string, opts: { builtin?: boolean } = {}): Promise<PluginManifest> {
    const manifest = await this.register(pluginDir, opts);
    await this.enable(manifest.name);
    return manifest;
  }

    /**
     * Re-validates a plugin against the signature and the CVE feed. Run at
     * register AND again at every enable/respawn, so a plugin whose files changed
     * on disk, or that was flagged by the CVE feed *after* registration, is
     * refused rather than silently re-spawned from cached state.
     */
    async #validate(dir: string, manifest: PluginManifest): Promise<void> {
        await this.#verifySignature(dir, manifest);
        if (this.#opts.cve && (await this.#opts.cve.isFlagged(manifest.name, manifest.version))) {
            throw new PressError(
                "forbidden",
                `Plugin "${manifest.name}@${manifest.version}" has a known vulnerability and was refused`,
            );
        }
    }

    /**
     * Marks a registered plugin enabled and persists that intent. The worker is
     * NOT spawned here — it starts lazily on the first invoke (and is torn down
     * again after the idle timeout). Validates up front so an enable of a
     * tampered/CVE-flagged plugin still fails loudly. Idempotent.
     */
  async enable(name: string): Promise<void> {
    const record = this.#registry.get(name);
    if (!record) throw new PressError("not_found", `Plugin not registered: ${name}`);
        await this.#validate(record.dir, record.manifest);
        record.enabled = true;
    await this.#opts.state?.setEnabled(name, true);
  }

    /** Disables the plugin: terminates any worker (zero footprint) and persists the state. Idempotent. */
  async disable(name: string): Promise<void> {
    const record = this.#registry.get(name);
    if (!record) return;
        record.enabled = false;
        this.#clearIdle(record);
    if (record.instance) {
      await record.instance.terminate();
      record.instance = null;
    }
    await this.#opts.state?.setEnabled(name, false);
  }

    /** True when the plugin is enabled (serves requests), regardless of whether its
     * worker is currently spawned — workers are lazy and idle-reclaimed. */
  has(name: string): boolean {
        return this.#registry.get(name)?.enabled === true;
    }

    /** True only while a worker thread is actually live for the plugin (for
     * observability/metrics; an enabled plugin may be idle with no worker). */
    isRunning(name: string): boolean {
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
        if (!record.enabled) continue; // disabled plugins serve no endpoints
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
          enabled: record.enabled,
        builtin: record.builtin,
      });
    }
    return out;
  }

  /**
   * Designer presets contributed by ENABLED plugins, for the studio palette.
   * Disabled plugins contribute nothing, so commerce/widget components appear
   * only once their plugin is turned on.
   */
  designerPresets(): { plugin: string; presets: DesignerPreset[] }[] {
    const out: { plugin: string; presets: DesignerPreset[] }[] = [];
    for (const [, record] of this.#registry) {
        if (record.enabled && record.presets.length) {
        out.push({ plugin: record.manifest.name, presets: record.presets });
      }
    }
    return out;
  }

  /** Enabled plugins that declare an admin panel, for the Studio panel list. */
  panels(): { plugin: string; title: string }[] {
    const out: { plugin: string; title: string }[] = [];
    for (const [, record] of this.#registry) {
        if (record.enabled && record.manifest.panel) {
        out.push({ plugin: record.manifest.name, title: record.manifest.panel.title });
      }
    }
    return out;
  }

    /** Reads an enabled plugin's admin panel script bundle (inlined into a sandboxed iframe). */
    async panel(name: string): Promise<{ title: string; script: string } | null> {
    const record = this.#registry.get(name);
        if (!record || !record.enabled || !record.manifest.panel) return null;
        const script = await readFile(resolveWithin(record.dir, record.manifest.panel.entry), "utf8");
        return {title: record.manifest.panel.title, script};
  }

  async invoke(name: string, method: string, args: unknown): Promise<unknown> {
    const record = this.#registry.get(name);
      if (!record || !record.enabled) throw new PressError("not_found", `Plugin not enabled: ${name}`);
      // Lazy-spawn: an enabled plugin's worker starts on its first invoke (or
      // respawns after an idle teardown). The spawn re-verifies the signature.
      const instance = await this.#ensureInstance(record);
      record.inflight++;
      this.#clearIdle(record); // never reclaim a worker that's mid-call
    try {
      return await instance.invoke(method, args, this.#timeout);
    } catch (e) {
      if (isTimeout(e)) {
          // Kill the (possibly wedged) worker; the next call respawns it lazily.
        await instance.terminate().catch(() => undefined);
          record.instance = null;
      }
      throw e;
    } finally {
        record.inflight--;
        if (record.inflight === 0 && record.instance) this.#armIdle(record);
    }
  }

  async stop(name: string): Promise<void> {
    const record = this.#registry.get(name);
    if (!record) return;
      this.#clearIdle(record);
    if (record.instance) await record.instance.terminate();
    this.#registry.delete(name);
  }

    /**
     * Returns the plugin's live worker, spawning one if it isn't running (lazy
     * start / idle respawn). Concurrent invokes share a single in-flight spawn so
     * exactly one worker is ever created.
     */
    async #ensureInstance(record: PluginRecord): Promise<PluginInstance> {
        if (record.instance) return record.instance;
        if (record.spawning) return record.spawning;
        record.spawning = (async () => {
            // Re-validate (signature + CVE feed) on every cold spawn so a plugin whose
            // files changed on disk, or that was flagged after it was enabled, is
            // refused here rather than silently respawned.
            await this.#validate(record.dir, record.manifest);
            const instance = await this.#spawn(record.dir, record.manifest, record.builtin);
            record.instance = instance;
            return instance;
        })();
        try {
            return await record.spawning;
        } finally {
            record.spawning = null;
        }
    }

    /** Arms the idle-teardown timer; fires once the worker has been quiet for the
     * configured timeout, terminating it to reclaim memory (the plugin stays
     * enabled and respawns on the next invoke). */
    #armIdle(record: PluginRecord): void {
        if (this.#idleMs <= 0) return; // idle teardown disabled — keep workers resident
        this.#clearIdle(record);
        const timer = setTimeout(() => {
            record.idleTimer = null;
            if (record.inflight > 0) return; // a call arrived first; leave it running
            const instance = record.instance;
            record.instance = null;
            void instance?.terminate().catch(() => undefined);
        }, this.#idleMs);
        timer.unref?.(); // an idle worker must never keep the process alive
        record.idleTimer = timer;
    }

    #clearIdle(record: PluginRecord): void {
        if (record.idleTimer) {
            clearTimeout(record.idleTimer);
            record.idleTimer = null;
        }
    }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#registry.keys()].map((name) => this.stop(name)));
  }

    async #spawn(pluginDir: string, manifest: PluginManifest, builtin: boolean): Promise<PluginInstance> {
        // Fail closed: without the OS permission model the worker has no kernel-level
        // sandbox — only the JS import allowlist + global scrub, which a determined
        // plugin can work around. Refuse to run UNTRUSTED (third-party) plugins in
        // that state rather than silently degrade the product's core isolation
        // guarantee. First-party builtins are trusted code, so they still load; an
        // operator can force third-party loads with PRESSH_INSECURE_NO_SANDBOX=1.
        if (
            !PERMISSION_MODEL_SUPPORTED &&
            !builtin &&
            process.env["PRESSH_INSECURE_NO_SANDBOX"] !== "1"
        ) {
            throw new PressError(
                "forbidden",
                `Refusing to load third-party plugin "${manifest.name}": the OS sandbox ` +
                `(Node --permission) is unavailable on this runtime. Upgrade to Node ≥20, ` +
                `or set PRESSH_INSECURE_NO_SANDBOX=1 to override (NOT recommended).`,
            );
        }
      // The permission model matches *resolved* paths, so the fs-read grant and
      // the plugin's import path must both be real-path'd or they won't match
      // (e.g. macOS `/tmp` vs `/private/tmp`).
      const realDir = PERMISSION_MODEL_SUPPORTED ? realpathSync(pluginDir) : pluginDir;
        // Re-verify the signature here — immediately before the worker imports the
        // plugin — so the bytes that execute are the bytes we just checked. This
        // shrinks the TOCTOU window between #validate (at register/enable) and the
        // actual import to near-zero.
        await this.#verifySignature(pluginDir, manifest);
    const worker = new Worker(this.#workerScript, {
      env: {},
        execArgv: this.#sandboxExecArgv(realDir),
        resourceLimits: {maxOldGenerationSizeMb: this.#maxMemoryMb, maxYoungGenerationSizeMb: this.#maxYoungMb},
        // The sandbox loader confines the plugin's own (relative/absolute/file:)
        // imports to this directory at the JS layer — defense-in-depth so a broad
        // fs-read grant can't be abused to import host/runtime files.
        workerData: {pluginRoot: realDir},
    });
    const instance = new PluginInstance(
      manifest,
      worker,
      (m, msg) => this.#handleServiceCall(m, msg),
      this.#opts.logger,
    );
      await instance.start(resolveWithin(realDir, manifest.main));
    return instance;
  }

    /**
     * Builds the worker's `execArgv` to enable the OS-level sandbox. The worker
     * gets the Node permission model with filesystem reads scoped to ONLY its own
     * plugin directory plus the runtime's compiled dir (so it can load
     * worker-entry + the sandbox loader). No fs-write, no child_process, no native
     * addons. `--allow-worker` is required for the worker's own RPC thread; the
     * plugin still cannot spawn a sub-worker because the sandbox loader denies it
     * `node:worker_threads`. Paths are real-path'd because the permission model
     * matches resolved paths (e.g. macOS `/tmp` → `/private/tmp`). `realPluginDir`
     * is already real-path'd by the caller.
     */
    #sandboxExecArgv(realPluginDir: string): string[] {
        if (!PERMISSION_MODEL_SUPPORTED) return [];
        const runtimeDir = dirname(realpathSync(this.#workerScript));
        return [
            "--permission",
            // Required for the worker's own RPC thread. Node warns this "could
            // invalidate the permission model" because a sub-worker could drop it —
            // but the sandbox loader denies the plugin `node:worker_threads`, so it
            // can never construct one. The warning is therefore expected noise.
            "--allow-worker",
            "--disable-warning=SecurityWarning",
            `--allow-fs-read=${runtimeDir}`,
            `--allow-fs-read=${realPluginDir}`,
        ];
    }

  /** Loads + sanitises a plugin's contributed designer presets (if any). */
  async #loadPresets(dir: string, manifest: PluginManifest): Promise<DesignerPreset[]> {
    if (!manifest.designerPresets) return [];
    try {
      const raw = await readFile(resolveWithin(dir, manifest.designerPresets), "utf8");
      return sanitizePresets(manifest.name, JSON.parse(raw));
    } catch {
      return []; // a missing/invalid presets file must not break plugin load
    }
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
      let signature: PluginSignature | null = null;
    try {
        signature = JSON.parse(await readFile(join(dir, SIGNATURE_FILE), "utf8")) as PluginSignature;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new PressError("forbidden", `Unreadable signature for "${manifest.name}"`);
      }
      signature = null;
    }

      if (!signature || !signature.files) {
      if (this.#opts.allowUnsigned) return;
      throw new PressError("forbidden", `Plugin "${manifest.name}" is unsigned`);
    }

      // A signature exists, so it must verify — even when unsigned plugins would
      // otherwise be allowed. Without a key we cannot verify it: fail closed
      // unless unsigned plugins are explicitly permitted (dev).
      if (!this.#signingKey) {
          if (this.#opts.allowUnsigned) return;
          throw new PressError(
              "forbidden",
              `Cannot verify "${manifest.name}": no plugin-signing key configured`,
          );
      }

      const result = await verifyPluginSignature(dir, signature, this.#signingKey);
      if (!result.ok) {
          throw new PressError(
              "forbidden",
              `Plugin "${manifest.name}" failed signature verification: ${result.reason}`,
          );
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
          // Auth-critical collections are filtered out so a plugin cannot even
          // learn that `users`/`sessions`/`invites` exist.
        this.#gate.assert(caps, "storage.read:*");
          const all = unwrap(await this.#opts.storage.listCollections());
          return all.filter((c) => !RESERVED_COLLECTIONS.has(c));
      }
        if (typeof args[0] !== "string") {
            throw new PressError("validation", "Collection name must be a string");
        }
        const collection = args[0];
      // Auth-critical collections are off-limits to plugins regardless of their
      // self-asserted capabilities (no `storage.read:*` / `storage.write:users`
        // can reach password hashes, session tokens, or invite tokens). Matched
        // case-insensitively and trimmed: a case-insensitive filesystem
        // (macOS/Windows, default file backend) collapses `Users`/`users `, so an
        // exact check would let a plugin declaring `storage.write:Users` slip past
        // and overwrite the real auth records on the next index rebuild.
        if (RESERVED_COLLECTIONS.has(collection.trim().toLowerCase())) {
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

      if (service === "pii") {
          if (method === "protect") {
              this.#gate.assert(caps, "pii.protect");
              if (!this.#opts.pii) throw new PressError("internal", "PII service not configured");
              return this.#opts.pii.protect(String(args[0]), String(args[1]));
          }
          if (method === "recordConsent") {
              this.#gate.assert(caps, "pii.consent");
              if (!this.#opts.pii) throw new PressError("internal", "PII service not configured");
              return this.#opts.pii.recordConsent(String(args[0]), String(args[1]), args[2] === true);
          }
      }

    throw new PressError("validation", `Unknown service: ${service}.${method}`);
  }
}
