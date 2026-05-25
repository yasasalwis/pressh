import type { StorageAdapter } from "@pressh/core";

/**
 * Persists which plugins are enabled. Disabled plugins spawn no worker at all
 * (zero footprint), so the enabled set is the source of truth both processes
 * read at boot and that the Studio toggles at runtime. State lives in storage
 * (the `plugin_state` collection), not worker memory, so the Studio and Site
 * processes agree across restarts.
 */
export interface PluginStateStore {
  isEnabled(name: string): Promise<boolean>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
}

const COLLECTION = "plugin_state";

interface PluginStateDoc {
  id: string;
  enabled: boolean;
  updatedAt: string;
  [key: string]: unknown;
}

/** Storage-backed {@link PluginStateStore}. Absent record ⇒ disabled (lean default). */
export function createPluginStateStore(storage: StorageAdapter): PluginStateStore {
  return {
    async isEnabled(name) {
      const result = await storage.get<PluginStateDoc>(COLLECTION, name);
      if (!result.ok || !result.value) return false;
      return result.value.enabled === true;
    },
    async setEnabled(name, enabled) {
      const doc: PluginStateDoc = { id: name, enabled, updatedAt: new Date().toISOString() };
      const result = await storage.put(COLLECTION, doc);
      if (!result.ok) throw result.error;
    },
  };
}
