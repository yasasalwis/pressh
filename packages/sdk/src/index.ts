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
  | { kind: "service-call"; id: number; service: "storage" | "secrets"; method: string; args: unknown[] };
