/**
 * Content-tag render cache (ADR-012). Pages cache indefinitely and are purged
 * by tag the instant their content changes — so editors get instant-live and
 * visitors get cache speed. (Cross-process invalidation is wired in Phase 14;
 * here it is a single-process in-memory cache.)
 */
export interface RenderCache {
  get(key: string): string | undefined;
  set(key: string, html: string, tags: string[]): void;
  invalidateTag(tag: string): void;
  clear(): void;
}

export function createRenderCache(): RenderCache {
  const entries = new Map<string, { html: string; tags: string[] }>();
  const tagToKeys = new Map<string, Set<string>>();

  return {
    get(key) {
      return entries.get(key)?.html;
    },
    set(key, html, tags) {
      entries.set(key, { html, tags });
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
