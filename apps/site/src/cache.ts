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

/**
 * Upper bound on cached pages. Without it, an attacker requesting many distinct
 * URLs could grow the in-memory cache until the process runs out of memory. With
 * it, the cache stays fast for the hot set and evicts the least-recently-served
 * entries instead of growing unbounded.
 */
const DEFAULT_MAX_ENTRIES = 5000;

export function createRenderCache(opts: { maxEntries?: number } = {}): RenderCache {
    const maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
    // Insertion order doubles as recency: a Map iterates oldest-first, and we
    // re-insert on touch, so the first key is always the least-recently-used.
  const entries = new Map<string, { html: string; version: string; tags: string[] }>();
  const tagToKeys = new Map<string, Set<string>>();

    const dropKey = (key: string): void => {
        const entry = entries.get(key);
        entries.delete(key);
        if (!entry) return;
        for (const tag of entry.tags) {
            const keys = tagToKeys.get(tag);
            if (!keys) continue;
            keys.delete(key);
            if (keys.size === 0) tagToKeys.delete(tag);
        }
    };

  return {
    get(key) {
      const entry = entries.get(key);
        if (!entry) return undefined;
        // Mark as most-recently-used so a hot page isn't evicted by a URL flood.
        entries.delete(key);
        entries.set(key, entry);
        return {html: entry.html, version: entry.version};
    },
    set(key, html, version, tags) {
        entries.delete(key);
      entries.set(key, { html, version, tags });
      for (const tag of tags) {
        const keys = tagToKeys.get(tag) ?? new Set<string>();
        keys.add(key);
        tagToKeys.set(tag, keys);
      }
        // Evict least-recently-used entries (with their tag index) past the cap.
        while (entries.size > maxEntries) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            dropKey(oldest);
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
