// SEO Toolkit — site-wide meta defaults plus per-page (per-slug) overrides,
// stored in `seo_meta`. `metaFor` is called server-side by the Site to inject
// <meta>/OpenGraph tags into the page <head>. Every URL prop (ogImage) passes
// through a scheme allowlist (http/https/relative only) so a `javascript:` or
// `data:` value can never be stored and later reflected — closing the stored-XSS
// gap called out in the roadmap.

const COLLECTION = "seo_meta";
const DEFAULTS_ID = "__defaults__";
const UNSAFE = /[^A-Za-z0-9._-]/g;

function overrideId(slug) {
  return ("o_" + String(slug).replace(UNSAFE, "_")).slice(0, 120);
}

/** Allow only http(s) and root-relative URLs; reject javascript:, data:, etc. */
function safeUrl(value) {
  const s = String(value ?? "").trim();
  if (s === "") return "";
  if (/^https?:\/\//i.test(s)) return s.slice(0, 500);
  if (s.startsWith("/") && !s.startsWith("//")) return s.slice(0, 500);
  return "";
}

// Valid `robots` meta directives. Anything else (free text, junk, control of
// indexing via crafted strings) is dropped so the tag can only ever emit
// recognized directives.
const ROBOTS_DIRECTIVES = new Set([
    "index", "noindex", "follow", "nofollow", "none", "all",
    "noarchive", "nosnippet", "noimageindex", "notranslate", "nocache",
]);
const ROBOTS_VALUED = /^(max-snippet|max-image-preview|max-video-preview):[a-z0-9-]{1,20}$/;

/** Keep only recognized robots directives, comma-joined. */
function cleanRobots(value) {
    return String(value ?? "")
        .toLowerCase()
        .split(",")
        .map((t) => t.trim())
        .filter((t) => ROBOTS_DIRECTIVES.has(t) || ROBOTS_VALUED.test(t))
        .slice(0, 8)
        .join(", ");
}

function cleanMeta(meta) {
  return {
    description: String(meta?.description ?? "").slice(0, 320),
    ogTitle: String(meta?.ogTitle ?? "").slice(0, 200),
    ogDescription: String(meta?.ogDescription ?? "").slice(0, 320),
    ogImage: safeUrl(meta?.ogImage),
      robots: cleanRobots(meta?.robots),
  };
}

const EMPTY = { description: "", ogTitle: "", ogDescription: "", ogImage: "", robots: "" };

/** @param {unknown} _args @param {import('@pressh/sdk').HostApi} host */
export async function getAll(_args, host) {
  const page = await host.storage.query(COLLECTION, undefined, { limit: 500 });
  let defaults = { ...EMPTY };
  const overrides = [];
  for (const doc of page.items) {
    if (doc.id === DEFAULTS_ID) defaults = cleanMeta(doc);
    else overrides.push({ slug: doc.slug, ...cleanMeta(doc) });
  }
  overrides.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  return { defaults, overrides };
}

/** @param {{ meta?: Record<string, unknown> }} args @param {import('@pressh/sdk').HostApi} host */
export async function saveDefaults(args, host) {
  const meta = cleanMeta(args?.meta ?? {});
  await host.storage.put(COLLECTION, { id: DEFAULTS_ID, ...meta });
  return { defaults: meta };
}

/** @param {{ slug?: string, meta?: Record<string, unknown> }} args @param {import('@pressh/sdk').HostApi} host */
export async function saveOverride(args, host) {
  const slug = String(args?.slug ?? "").trim();
  if (!slug) throw new Error("A page slug is required");
  const meta = cleanMeta(args?.meta ?? {});
  await host.storage.put(COLLECTION, { id: overrideId(slug), slug, ...meta });
  return { ok: true };
}

/** @param {{ slug?: string }} args @param {import('@pressh/sdk').HostApi} host */
export async function removeOverride(args, host) {
  const slug = String(args?.slug ?? "").trim();
  if (!slug) throw new Error("A page slug is required");
  await host.storage.delete(COLLECTION, overrideId(slug));
  return { ok: true };
}

/** Merges defaults with any per-slug override. Called by the Site on render. */
export async function metaFor(args, host) {
  const slug = String(args?.slug ?? "").trim();
  const defaultsDoc = await host.storage.get(COLLECTION, DEFAULTS_ID);
  let meta = defaultsDoc ? cleanMeta(defaultsDoc) : { ...EMPTY };
  if (slug) {
    const ov = await host.storage.get(COLLECTION, overrideId(slug));
    if (ov) {
      const o = cleanMeta(ov);
      meta = {
        description: o.description || meta.description,
        ogTitle: o.ogTitle || meta.ogTitle,
        ogDescription: o.ogDescription || meta.ogDescription,
        ogImage: o.ogImage || meta.ogImage,
        robots: o.robots || meta.robots,
      };
    }
  }
  return meta;
}
