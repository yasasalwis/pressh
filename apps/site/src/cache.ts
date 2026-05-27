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
 * Total cached-HTML budget in bytes. The cache is bounded by *memory*, not entry
 * count, because page sizes vary wildly — 5000 tiny pages and 5000 50 KB pages
 * have very different footprints, and only the byte budget keeps a small VM
 * safe. Without it an attacker requesting many distinct URLs could grow the
 * cache until the process OOMs. ~24 MB suits a 512 MB box; raise it with
 * PRESSH_RENDER_CACHE_MAX_BYTES on larger hosts.
 */
const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;
/** Secondary safety cap on entry count, bounding Map + tag-index overhead even
 * when individual pages are tiny. The byte budget is the primary constraint. */
const DEFAULT_MAX_ENTRIES = 5000;

/** Approximate resident bytes of one cached entry (HTML + key + tag strings). */
function entrySize(key: string, html: string, tags: string[]): number {
    let bytes = Buffer.byteLength(html) + Buffer.byteLength(key);
    for (const tag of tags) bytes += Buffer.byteLength(tag);
    return bytes;
}

export function createRenderCache(opts: { maxBytes?: number; maxEntries?: number } = {}): RenderCache {
    const maxBytes = Math.max(
        1,
        opts.maxBytes ?? envInt("PRESSH_RENDER_CACHE_MAX_BYTES") ?? DEFAULT_MAX_BYTES,
    );
    const maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
    // Insertion order doubles as recency: a Map iterates oldest-first, and we
    // re-insert on touch, so the first key is always the least-recently-used.
    const entries = new Map<string, { html: string; version: string; tags: string[]; bytes: number }>();
  const tagToKeys = new Map<string, Set<string>>();
    let totalBytes = 0;

    const dropKey = (key: string): void => {
        const entry = entries.get(key);
        entries.delete(key);
        if (!entry) return;
        totalBytes -= entry.bytes;
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
        dropKey(key); // replace any existing entry (and reclaim its bytes) first
        const bytes = entrySize(key, html, tags);
        // A single page larger than the whole budget is never worth caching.
        if (bytes > maxBytes) return;
        entries.set(key, {html, version, tags, bytes});
        totalBytes += bytes;
      for (const tag of tags) {
        const keys = tagToKeys.get(tag) ?? new Set<string>();
        keys.add(key);
        tagToKeys.set(tag, keys);
      }
        // Evict least-recently-used entries (with their tag index) until both the
        // byte budget and the entry-count safety cap are satisfied.
        while (totalBytes > maxBytes || entries.size > maxEntries) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            dropKey(oldest);
        }
    },
    invalidateTag(tag) {
      const keys = tagToKeys.get(tag);
      if (!keys) return;
        // Snapshot: dropKey mutates tagToKeys (removing the key from every tag).
        for (const key of [...keys]) dropKey(key);
      tagToKeys.delete(tag);
    },
    clear() {
      entries.clear();
      tagToKeys.clear();
        totalBytes = 0;
    },
  };
}

/** Parses a positive integer env var; returns undefined when unset/invalid. */
function envInt(name: string): number | undefined {
    const raw = process.env[name];
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
}
