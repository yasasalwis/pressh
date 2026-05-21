import { randomUUID } from "node:crypto";
import { CapabilityGate, PressError } from "@pressh/core";
import type { AuditLog, Result, StorageAdapter } from "@pressh/core";
import { createBlockRegistry } from "./blocks/registry.js";
import { sanitizeBlocks } from "./blocks/sanitize.js";
import type { BlockRegistry } from "./blocks/types.js";
import { validateFields } from "./schema.js";
import { capabilityForTransition, isAllowedTransition } from "./state-machine.js";
import type { ContentEntry, ContentStatus, ContentType, FieldDef, Revision } from "./types.js";

const TYPES = "content_types";
const ENTRIES = "content_entries";
const REVISIONS = "revisions";
const DEFAULT_LOCALE = "en";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function must<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function revisionId(entryId: string, version: number): string {
  return `${entryId}.${version}`;
}

export interface CreateTypeInput {
  name: string;
  slug: string;
  fields: FieldDef[];
}

export interface CreateEntryInput {
  typeId: string;
  slug: string;
  authorId: string;
  fields: Record<string, unknown>;
  blocks?: unknown[];
  locale?: string;
}

export interface SaveEntryInput {
  fields: Record<string, unknown>;
  blocks?: unknown[];
  editorId: string;
}

export interface ContentServiceOptions {
  storage: StorageAdapter;
  audit: AuditLog;
  now?: () => number;
  blockRegistry?: BlockRegistry;
}

export interface ContentService {
  createType(capabilities: string[], input: CreateTypeInput): Promise<ContentType>;
  getType(id: string): Promise<ContentType | null>;
  createEntry(capabilities: string[], input: CreateEntryInput): Promise<ContentEntry>;
  saveEntry(capabilities: string[], entryId: string, input: SaveEntryInput): Promise<ContentEntry>;
  transition(
    capabilities: string[],
    entryId: string,
    to: ContentStatus,
    opts?: { scheduledFor?: string },
  ): Promise<ContentEntry>;
  restoreRevision(
    capabilities: string[],
    entryId: string,
    version: number,
    editorId: string,
  ): Promise<ContentEntry>;
  getEntry(id: string): Promise<ContentEntry | null>;
  getRevision(entryId: string, version: number): Promise<Revision | null>;
  listRevisions(entryId: string): Promise<Revision[]>;
  resolveBySlug(
    slug: string,
    locale?: string,
    opts?: { publicOnly?: boolean },
  ): Promise<ContentEntry | null>;
}

class ContentServiceImpl implements ContentService {
  readonly #storage: StorageAdapter;
  readonly #audit: AuditLog;
  readonly #now: () => number;
  readonly #gate = new CapabilityGate();
  readonly #blocks: BlockRegistry;

  constructor(opts: ContentServiceOptions) {
    this.#storage = opts.storage;
    this.#audit = opts.audit;
    this.#now = opts.now ?? (() => Date.now());
    this.#blocks = opts.blockRegistry ?? createBlockRegistry();
  }

  #iso(): string {
    return new Date(this.#now()).toISOString();
  }

  async #requireType(id: string): Promise<ContentType> {
    const type = must(await this.#storage.get<ContentType>(TYPES, id));
    if (!type) throw new PressError("not_found", `Content type not found: ${id}`);
    return type;
  }

  async #requireEntry(id: string): Promise<ContentEntry> {
    const entry = must(await this.#storage.get<ContentEntry>(ENTRIES, id));
    if (!entry) throw new PressError("not_found", `Content entry not found: ${id}`);
    return entry;
  }

  async #addRevision(
    entry: ContentEntry,
    fields: Record<string, unknown>,
    blocks: unknown[],
    editorId: string,
    version: number,
  ): Promise<Revision> {
    const revision: Revision = {
      id: revisionId(entry.id, version),
      entryId: entry.id,
      version,
      fields,
      blocks,
      editorId,
      createdAt: this.#iso(),
    };
    must(await this.#storage.put(REVISIONS, revision));
    return revision;
  }

  async createType(capabilities: string[], input: CreateTypeInput): Promise<ContentType> {
    this.#gate.assert(capabilities, "types.manage");
    if (!SLUG_RE.test(input.slug)) {
      throw new PressError("validation", `Invalid type slug: ${input.slug}`);
    }
    const names = new Set<string>();
    for (const field of input.fields) {
      if (names.has(field.name)) {
        throw new PressError("validation", `Duplicate field name: ${field.name}`);
      }
      names.add(field.name);
      if (field.type === "select" && (field.options ?? []).length === 0) {
        throw new PressError("validation", `Select field "${field.name}" requires options`);
      }
    }

    const type: ContentType = {
      id: randomUUID(),
      name: input.name,
      slug: input.slug,
      fields: input.fields,
      createdAt: this.#iso(),
    };
    must(await this.#storage.put(TYPES, type));
    await this.#audit.append({
      action: "type.create",
      actorId: null,
      detail: { typeId: type.id, slug: type.slug },
    });
    return type;
  }

  async getType(id: string): Promise<ContentType | null> {
    return must(await this.#storage.get<ContentType>(TYPES, id));
  }

  async createEntry(capabilities: string[], input: CreateEntryInput): Promise<ContentEntry> {
    this.#gate.assert(capabilities, "content.create");
    if (!SLUG_RE.test(input.slug)) {
      throw new PressError("validation", `Invalid slug: ${input.slug}`);
    }
    const locale = input.locale ?? DEFAULT_LOCALE;
    const type = await this.#requireType(input.typeId);
    const validated = validateFields(type.fields, input.fields);
    const blocks = sanitizeBlocks(this.#blocks, input.blocks ?? [], { capabilities });

    const existing = must(
      await this.#storage.query<ContentEntry>(ENTRIES, { where: { slug: input.slug, locale } }),
    );
    if (existing.items.length > 0) {
      throw new PressError("conflict", `Slug "${input.slug}" already exists for locale ${locale}`);
    }

    const entry: ContentEntry = {
      id: randomUUID(),
      typeId: input.typeId,
      slug: input.slug,
      locale,
      status: "draft",
      authorId: input.authorId,
      currentRevision: 1,
      publishedAt: null,
      scheduledFor: null,
      createdAt: this.#iso(),
      updatedAt: this.#iso(),
    };
    must(await this.#storage.put(ENTRIES, entry));
    await this.#addRevision(entry, validated, blocks, input.authorId, 1);
    await this.#audit.append({
      action: "content.create",
      actorId: input.authorId,
      detail: { entryId: entry.id, typeId: entry.typeId, slug: entry.slug, locale },
    });
    return entry;
  }

  async saveEntry(
    capabilities: string[],
    entryId: string,
    input: SaveEntryInput,
  ): Promise<ContentEntry> {
    this.#gate.assert(capabilities, "content.update");
    const entry = await this.#requireEntry(entryId);
    const type = await this.#requireType(entry.typeId);
    const validated = validateFields(type.fields, input.fields);
    const blocks = sanitizeBlocks(this.#blocks, input.blocks ?? [], { capabilities });

    const version = entry.currentRevision + 1;
    await this.#addRevision(entry, validated, blocks, input.editorId, version);
    entry.currentRevision = version;
    entry.updatedAt = this.#iso();
    must(await this.#storage.put(ENTRIES, entry));
    await this.#audit.append({
      action: "content.update",
      actorId: input.editorId,
      detail: { entryId: entry.id, version },
    });
    return entry;
  }

  async transition(
    capabilities: string[],
    entryId: string,
    to: ContentStatus,
    opts: { scheduledFor?: string } = {},
  ): Promise<ContentEntry> {
    const entry = await this.#requireEntry(entryId);
    if (!isAllowedTransition(entry.status, to)) {
      throw new PressError("conflict", `Illegal transition: ${entry.status} → ${to}`);
    }
    this.#gate.assert(capabilities, capabilityForTransition(to));

    const from = entry.status;
    entry.status = to;
    if (to === "published") {
      entry.publishedAt = this.#iso();
      entry.scheduledFor = null;
    } else if (to === "scheduled") {
      if (!opts.scheduledFor) {
        throw new PressError("validation", "Scheduling requires a scheduledFor timestamp");
      }
      entry.scheduledFor = opts.scheduledFor;
    } else if (to === "draft") {
      entry.publishedAt = null;
    }
    entry.updatedAt = this.#iso();
    must(await this.#storage.put(ENTRIES, entry));
    await this.#audit.append({
      action: "content.transition",
      actorId: null,
      detail: { entryId: entry.id, from, to },
    });
    return entry;
  }

  async restoreRevision(
    capabilities: string[],
    entryId: string,
    version: number,
    editorId: string,
  ): Promise<ContentEntry> {
    this.#gate.assert(capabilities, "content.update");
    const entry = await this.#requireEntry(entryId);
    const source = await this.getRevision(entryId, version);
    if (!source) throw new PressError("not_found", `Revision not found: ${version}`);

    const newVersion = entry.currentRevision + 1;
    await this.#addRevision(entry, source.fields, source.blocks, editorId, newVersion);
    entry.currentRevision = newVersion;
    entry.updatedAt = this.#iso();
    must(await this.#storage.put(ENTRIES, entry));
    await this.#audit.append({
      action: "content.restore",
      actorId: editorId,
      detail: { entryId: entry.id, fromVersion: version, newVersion },
    });
    return entry;
  }

  async getEntry(id: string): Promise<ContentEntry | null> {
    return must(await this.#storage.get<ContentEntry>(ENTRIES, id));
  }

  async getRevision(entryId: string, version: number): Promise<Revision | null> {
    return must(await this.#storage.get<Revision>(REVISIONS, revisionId(entryId, version)));
  }

  async listRevisions(entryId: string): Promise<Revision[]> {
    const page = must(await this.#storage.query<Revision>(REVISIONS, { where: { entryId } }));
    return page.items.sort((a, b) => a.version - b.version);
  }

  async resolveBySlug(
    slug: string,
    locale: string = DEFAULT_LOCALE,
    opts: { publicOnly?: boolean } = {},
  ): Promise<ContentEntry | null> {
    const page = must(
      await this.#storage.query<ContentEntry>(ENTRIES, { where: { slug, locale } }),
    );
    const entry = page.items[0] ?? null;
    if (!entry) return null;
    if (opts.publicOnly && entry.status !== "published") return null;
    return entry;
  }
}

export function createContentService(opts: ContentServiceOptions): ContentService {
  return new ContentServiceImpl(opts);
}
