/**
 * @pressh/sdk — the public, dependency-free surface shared by the host and the
 * plugin worker. It is *only types*: the manifest, the RPC message protocol,
 * and the HostApi that plugin handlers receive. Plugins never import host
 * internals — the host injects a capability-gated `HostApi` into each handler.
 */
export const PRESSH_SDK_VERSION = "0.0.0";

export interface EndpointDef {
  method: string;
  path: string;
  /** Name of the exported handler function in the plugin module. */
  handler: string;
}

export interface PluginPanelDef {
  title: string;
  /** HTML file (relative to the plugin folder) rendered in a sandboxed iframe. */
  entry: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  /** Entry module filename, relative to the plugin folder (e.g. "index.mjs"). */
  main: string;
  capabilities: string[];
  endpoints?: EndpointDef[];
  panel?: PluginPanelDef;
  /**
   * Handler names the sandboxed admin panel may invoke via the host bridge.
   * Default-deny: a panel can only call handlers listed here, never arbitrary
   * exports. Omit (or leave empty) for a display-only panel.
   */
  panelActions?: string[];
    /**
     * Relative path (inside the plugin folder) to a JSON file of designer presets
     * the plugin contributes to the studio page builder. They appear in the
     * palette ONLY while the plugin is enabled. Each preset is a
     * `{ id, name, icon, category, description, template }` of primitive nodes.
     */
    designerPresets?: string;
}

/** A designer preset (component) a plugin contributes to the studio palette. */
export interface DesignerPreset {
    id: string;
    name: string;
    icon: string;
    category: string;
    description: string;
    /** Tree of primitive nodes (rendered/validated by the engine). */
    template: unknown[];
}

/** The capability-gated services a plugin handler may use. */
export interface HostApi {
  log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    fields?: Record<string, unknown>,
  ): void;
  storage: {
    get(collection: string, id: string): Promise<unknown>;
    put(collection: string, doc: { id: string; [key: string]: unknown }): Promise<void>;
    delete(collection: string, id: string): Promise<void>;
    query(
      collection: string,
      where?: Record<string, string | number | boolean>,
      page?: { limit?: number; after?: string | null },
    ): Promise<{ items: unknown[]; nextCursor: string | null }>;
    /** Lists collection names that hold records. Requires `storage.read:*`. */
    list(): Promise<string[]>;
  };
  secrets: {
    get(name: string): Promise<string>;
  };
    /**
     * Privacy primitives for plugins that handle personal data (capability-gated,
     * default-deny like every other host service). `protect` seals a value in the
     * vault under the subject's namespace and returns an opaque `{$enc}` reference
     * the plugin can store — the plaintext is recoverable only via a host-side GDPR
     * export and is crypto-shredded on erasure. There is deliberately NO reveal:
     * a compromised worker can encrypt PII but never read sealed PII back.
     */
    pii: {
        protect(subjectRef: string, value: string): Promise<{ $enc: string }>;
        recordConsent(subjectRef: string, scope: string, granted: boolean): Promise<void>;
    };
}

export type PluginHandler = (args: unknown, host: HostApi) => unknown | Promise<unknown>;
export type PluginModule = Record<string, PluginHandler>;

export interface RpcError {
  code: string;
  message: string;
}

/** Messages sent host → worker. */
export type HostToWorker =
  | { kind: "init"; manifest: PluginManifest; pluginPath: string }
  | { kind: "invoke"; id: number; method: string; args: unknown }
  | { kind: "service-result"; id: number; ok: true; value: unknown }
  | { kind: "service-result"; id: number; ok: false; error: RpcError };

/** Messages sent worker → host. */
export type WorkerToHost =
  | { kind: "ready" }
  | { kind: "error"; message: string }
  | { kind: "log"; level: "debug" | "info" | "warn" | "error"; message: string; fields: Record<string, unknown> }
  | { kind: "invoke-result"; id: number; ok: true; value: unknown }
  | { kind: "invoke-result"; id: number; ok: false; error: RpcError }
    | { kind: "service-call"; id: number; service: "storage" | "secrets" | "pii"; method: string; args: unknown[] };
