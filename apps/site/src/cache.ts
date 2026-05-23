/**
 * Content-tag render cache (ADR-012). Pages cache indefinitely and are purged
 * the instant their content changes — so editors get instant-live and visitors
 * get cache speed.
 *
 * Because the Studio and Site run as separate processes (ADR-002), an in-memory
 * tag purge in the Studio cannot reach the Site's cache. Instead each cached
 * entry carries a `version` stamp (the content's `updatedAt`); the front
 * controller resolves the entry on every request and serves the cached HTML
 * only while the version still matches. A publish/save bumps `updatedAt`, so the
 * next request re-renders. This keeps the expensive render skip while staying
 * correct across processes.
 */
export interface CachedPage {
  html: string;
  version: string;
}

export interface RenderCache {
  get(key: string): CachedPage | undefined;
  set(key: string, html: string, version: string, tags: string[]): void;
  invalidateTag(tag: string): void;
  clear(): void;
}

export function createRenderCache(): RenderCache {
  const entries = new Map<string, { html: string; version: string; tags: string[] }>();
  const tagToKeys = new Map<string, Set<string>>();

  return {
    get(key) {
      const entry = entries.get(key);
      return entry ? { html: entry.html, version: entry.version } : undefined;
    },
    set(key, html, version, tags) {
      entries.set(key, { html, version, tags });
      for (const tag of tags) {
        const keys = tagToKeys.get(tag) ?? new Set<string>();
        keys.add(key);
        tagToKeys.set(tag, keys);
      }
    },
    invalidateTag(tag) {
      const keys = tagToKeys.get(tag);
      if (!keys) return;
      for (const key of keys) entries.delete(key);
      tagToKeys.delete(tag);
    },
    clear() {
      entries.clear();
      tagToKeys.clear();
    },
  };
}
