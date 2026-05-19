// @pressh/sdk (worker entry) — the public API plugins import.
//
// Everything here is a proxy that serializes calls into structured-clone
// RPC over parentPort. Plugins must not import @pressh/core, @pressh/engine,
// @pressh/sdk/host, or @pressh/sdk/internal. See docs/ARCHITECTURE.md §9.

export const SDK_VERSION = "0.1.0";

export interface ManifestSpec {
  id: string;
  version: string;
  sdkVersion: string;
  dependencies?: Record<string, string>;
  needs?: readonly string[];
  declares?: {
    capabilities?: readonly string[];
    contentTypes?: readonly string[];
    endpoints?: ReadonlyArray<{ path: string; method?: string }>;
    adminPanels?: ReadonlyArray<{ path: string; title: string }>;
  };
  entry: string;
}

export function defineManifest(spec: ManifestSpec): ManifestSpec {
  return spec;
}
