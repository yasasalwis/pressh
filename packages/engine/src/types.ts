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
