/**
 * @pressh/runtime — host-side plugin runtime.
 *
 * Phase 8: the worker-thread PluginHost (capability-gated RPC, signature
 * verification, endpoint manifest, timeout/kill/respawn) and the worker entry
 * script. The iframe shim for plugin admin panels lands in Phase 12.
 */
export const PRESSH_RUNTIME_VERSION = "0.0.0";

export { PluginHost } from "./host.js";
export type { LoadedEndpoint, PluginHostOptions } from "./host.js";
