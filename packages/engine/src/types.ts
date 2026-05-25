import type { StoredDoc } from "@pressh/core";

export type FieldType = "text" | "richtext" | "number" | "boolean" | "date" | "select";

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  /** Marks PII/secret fields for encryption + log redaction (baseline #6). */
  sensitive?: boolean;
}

export type ContentStatus = "draft" | "in_review" | "scheduled" | "published" | "archived";

export interface ContentType extends StoredDoc {
  name: string;
  slug: string;
  fields: FieldDef[];
  createdAt: string;
}

export const SYSTEM_SLUGS = {
  header: "header",
  footer: "footer",
  home: "home",
  notFound: "404",
  serverError: "500",
  maintenance: "maintenance",
} as const;

export type SystemSlug = (typeof SYSTEM_SLUGS)[keyof typeof SYSTEM_SLUGS];

/**
 * Layout fragments are rendered standalone and injected into the chrome of every
 * page (header at the top, footer at the bottom).
 */
export const LAYOUT_FRAGMENT_SLUGS: readonly SystemSlug[] = [
  SYSTEM_SLUGS.header,
  SYSTEM_SLUGS.footer,
];

/**
 * Standalone system pages are full documents the site serves directly: the
 * homepage (`/`), the not-found (404) and server-error (500) pages, and the
 * maintenance page shown while maintenance mode is on.
 */
export const SYSTEM_PAGE_SLUGS: readonly SystemSlug[] = [
  SYSTEM_SLUGS.home,
  SYSTEM_SLUGS.notFound,
  SYSTEM_SLUGS.serverError,
  SYSTEM_SLUGS.maintenance,
];

export function isLayoutFragmentSlug(slug: string): boolean {
  return (LAYOUT_FRAGMENT_SLUGS as readonly string[]).includes(slug);
}

export interface ContentEntry extends StoredDoc {
  typeId: string;
  slug: string;
  locale: string;
  status: ContentStatus;
  authorId: string;
  currentRevision: number;
  publishedAt: string | null;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
  /** Marks built-in system pages (header, footer, home, 404, 500, maintenance) — cannot be archived or unpublished. */
  system?: boolean;
}

export interface Revision extends StoredDoc {
  /** id is `${entryId}.${version}` so revisions are addressable and sortable. */
  entryId: string;
  version: number;
  fields: Record<string, unknown>;
  blocks: unknown[];
  editorId: string;
  createdAt: string;
}
