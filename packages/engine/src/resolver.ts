import {CapabilityGate, PressError} from "@pressh/core";
import type {BlockNode} from "./blocks/types.js";
import type {ContentService} from "./content-service.js";
import type {ContentStatus} from "./types.js";

export interface ParsedRoute {
  slug: string;
  locale: string;
}

export interface ParsePathOptions {
  locales?: string[];
  defaultLocale?: string;
  homeSlug?: string;
}

/**
 * Maps a URL path to a (slug, locale). A leading segment that matches a known
 * locale is treated as the locale prefix; the rest is the slug; an empty path
 * resolves to the home slug. (Hierarchical/nested slugs are deferred.)
 */
export function parsePath(path: string, opts: ParsePathOptions = {}): ParsedRoute {
  const locales = opts.locales ?? [];
  const defaultLocale = opts.defaultLocale ?? "en";
  const homeSlug = opts.homeSlug ?? "home";

  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  let locale = defaultLocale;
  const first = segments[0];
  if (first !== undefined && locales.includes(first)) {
    locale = first;
    segments.shift();
  }

  return { slug: segments.join("/") || homeSlug, locale };
}

export type ResolveScope = "public" | "admin";

export interface ResolveOptions {
  slug: string;
  locale?: string;
  scope: ResolveScope;
  capabilities?: string[];
}

export interface ResolvedContent {
  id: string;
  typeId: string;
  slug: string;
  locale: string;
  status: ContentStatus;
  fields: Record<string, unknown>;
  blocks: BlockNode[];
  /** Author identity is exposed only to admin-scope reads (anti-enumeration). */
  authorId: string | null;
  publishedAt: string | null;
  updatedAt: string;
  /** Monotonic revision number — bumps on every save; used as a cache version. */
  revision: number;
    /** True when the page is gated for members only. Absent (undefined) means public. */
    requiresMembership?: boolean;
}

export interface QueryResolver {
  resolve(opts: ResolveOptions): Promise<ResolvedContent>;
  resolvePath(
    path: string,
    opts: { scope: ResolveScope; capabilities?: string[] },
  ): Promise<ResolvedContent>;
}

export interface QueryResolverOptions {
  content: ContentService;
  defaultLocale?: string;
  homeSlug?: string;
  locales?: string[];
}

export function createQueryResolver(opts: QueryResolverOptions): QueryResolver {
  const gate = new CapabilityGate();
  const defaultLocale = opts.defaultLocale ?? "en";

  async function resolve(o: ResolveOptions): Promise<ResolvedContent> {
    const locale = o.locale ?? defaultLocale;
    const capabilities = o.capabilities ?? [];

    // Unauthorized admin reads return the SAME not_found as a missing resource,
    // so a 404 reveals nothing about whether content exists (anti-enumeration).
    if (o.scope === "admin" && !gate.check(capabilities, "content.read")) {
      throw new PressError("not_found", "Not found");
    }

    const entry = await opts.content.resolveBySlug(o.slug, locale, {
      publicOnly: o.scope === "public",
    });
    if (!entry) throw new PressError("not_found", "Not found");

    const revision = await opts.content.getRevision(entry.id, entry.currentRevision);
    if (!revision) throw new PressError("not_found", "Not found");

    return {
      id: entry.id,
      typeId: entry.typeId,
      slug: entry.slug,
      locale: entry.locale,
      status: entry.status,
      fields: revision.fields,
      blocks: revision.blocks as BlockNode[],
      authorId: o.scope === "admin" ? entry.authorId : null,
      publishedAt: entry.publishedAt,
      updatedAt: entry.updatedAt,
      revision: entry.currentRevision,
        ...(entry.requiresMembership ? {requiresMembership: true} : {}),
    };
  }

  async function resolvePath(
    path: string,
    o: { scope: ResolveScope; capabilities?: string[] },
  ): Promise<ResolvedContent> {
    const route = parsePath(path, {
      locales: opts.locales ?? [],
      defaultLocale,
      homeSlug: opts.homeSlug ?? "home",
    });
    return resolve({
      slug: route.slug,
      locale: route.locale,
      scope: o.scope,
      capabilities: o.capabilities ?? [],
    });
  }

  return { resolve, resolvePath };
}
