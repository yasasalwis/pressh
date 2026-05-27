import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import type {AuditLog, SecretsBackend, StorageAdapter} from "@pressh/core";
import {
    capabilitiesForRoles,
    createFileAuditLog,
    createFileSecretsBackend,
    createFileSystemStorage,
} from "@pressh/core";
import type {ContentService, QueryResolver} from "@pressh/engine";
import {createContentService, createQueryResolver, parsePath, SENSITIVE_MASK,} from "@pressh/engine";

const ADMIN = capabilitiesForRoles(["admin"]);
const EDITOR = capabilitiesForRoles(["editor"]);
const VIEWER = capabilitiesForRoles(["viewer"]); // has content.read, not content.reveal

describe("parsePath", () => {
  it("parses a flat slug", () => {
    expect(parsePath("/about")).toEqual({ slug: "about", locale: "en" });
  });
  it("strips a known locale prefix", () => {
    expect(parsePath("/fr/about", { locales: ["fr"] })).toEqual({ slug: "about", locale: "fr" });
  });
  it("maps the root path to the home slug", () => {
    expect(parsePath("/", { homeSlug: "home" })).toEqual({ slug: "home", locale: "en" });
  });
  it("ignores an unknown leading segment as a locale", () => {
    expect(parsePath("/de/x", { locales: ["fr"] })).toEqual({ slug: "de/x", locale: "en" });
  });
});

describe("QueryResolver", () => {
  let dir: string;
  let storage: StorageAdapter;
  let audit: AuditLog;
  let svc: ContentService;
  let resolver: QueryResolver;
  let entryId: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-resolver-"));
    storage = createFileSystemStorage({ root: join(dir, "content") });
    audit = await createFileAuditLog({ path: join(dir, "audit.log") });
    svc = createContentService({ storage, audit });
    resolver = createQueryResolver({ content: svc });

    const type = await svc.createType(ADMIN, {
      name: "Page",
      slug: "page",
      fields: [{ id: "1", name: "title", type: "text", required: true }],
    });
    const entry = await svc.createEntry(EDITOR, {
      typeId: type.id,
      slug: "about",
      authorId: "u1",
      fields: { title: "About" },
      blocks: [{ type: "paragraph", content: "hi" }],
    });
    entryId = entry.id;
  });

  afterEach(async () => {
    storage.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("does not resolve a draft in public scope", async () => {
    await expect(resolver.resolve({ slug: "about", scope: "public" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("resolves a published entry in public scope without leaking the author", async () => {
    await svc.transition(EDITOR, entryId, "published");
    const resolved = await resolver.resolve({ slug: "about", scope: "public" });
    expect(resolved.status).toBe("published");
    expect(resolved.authorId).toBeNull();
    expect(resolved.blocks[0]?.content).toBe("hi");
    expect(resolved.fields["title"]).toBe("About");
  });

  it("resolves drafts in admin scope and exposes the author", async () => {
    const resolved = await resolver.resolve({
      slug: "about",
      scope: "admin",
      capabilities: VIEWER,
    });
    expect(resolved.status).toBe("draft");
    expect(resolved.authorId).toBe("u1");
  });

  it("returns uniform not_found for an admin read without content.read", async () => {
    await expect(
      resolver.resolve({ slug: "about", scope: "admin", capabilities: [] }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("returns not_found for a missing slug", async () => {
    await expect(resolver.resolve({ slug: "ghost", scope: "public" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("resolves by path", async () => {
    await svc.transition(EDITOR, entryId, "published");
    const resolved = await resolver.resolvePath("/about", { scope: "public" });
    expect(resolved.slug).toBe("about");
  });
});

describe("QueryResolver — sensitive fields", () => {
    let dir: string;
    let storage: StorageAdapter;
    let audit: AuditLog;
    let secrets: SecretsBackend;
    let svc: ContentService;
    let resolver: QueryResolver;
    let entryId: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "pressh-resolver-sens-"));
        storage = createFileSystemStorage({root: join(dir, "content")});
        audit = await createFileAuditLog({path: join(dir, "audit.log")});
        secrets = await createFileSecretsBackend({path: join(dir, "vault.json"), key: randomBytes(32)});
        svc = createContentService({storage, audit, secrets});
        resolver = createQueryResolver({content: svc, secrets});

        const type = await svc.createType(ADMIN, {
            name: "Lead",
            slug: "lead",
            fields: [
                {id: "1", name: "title", type: "text", required: true},
                {id: "2", name: "ssn", type: "text", required: false, sensitive: true},
            ],
        });
        const entry = await svc.createEntry(EDITOR, {
            typeId: type.id,
            slug: "secret-lead",
            authorId: "u1",
            fields: {title: "Lead", ssn: "123-45-6789"},
        });
        entryId = entry.id;
        await svc.transition(EDITOR, entryId, "published");
    });

    afterEach(async () => {
        storage.close();
        await rm(dir, {recursive: true, force: true});
    });

    it("masks a sensitive field on public reads", async () => {
        const resolved = await resolver.resolve({slug: "secret-lead", scope: "public"});
        expect(resolved.fields["title"]).toBe("Lead");
        expect(resolved.fields["ssn"]).toBe(SENSITIVE_MASK);
    });

    it("reveals a sensitive field to an admin holding content.reveal", async () => {
        const resolved = await resolver.resolve({
            slug: "secret-lead",
            scope: "admin",
            capabilities: EDITOR, // editor now carries content.reveal
        });
        expect(resolved.fields["ssn"]).toBe("123-45-6789");
    });

    it("masks a sensitive field for an admin read without content.reveal", async () => {
        const resolved = await resolver.resolve({
            slug: "secret-lead",
            scope: "admin",
            capabilities: VIEWER,
        });
        expect(resolved.fields["ssn"]).toBe(SENSITIVE_MASK);
    });

    it("never stores the plaintext in the revision", async () => {
        const entry = await svc.getEntry(entryId);
        const rev = await svc.getRevision(entryId, entry!.currentRevision);
        const ssn = rev!.fields["ssn"] as { $enc?: string };
        expect(ssn.$enc).toBeDefined();
        expect(JSON.stringify(rev!.fields)).not.toContain("123-45-6789");
    });
});

describe("QueryResolver — search", () => {
    let dir: string;
    let storage: StorageAdapter;
    let audit: AuditLog;
    let secrets: SecretsBackend;
    let svc: ContentService;
    let resolver: QueryResolver;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "pressh-search-"));
        storage = createFileSystemStorage({root: join(dir, "content")});
        audit = await createFileAuditLog({path: join(dir, "audit.log")});
        secrets = await createFileSecretsBackend({path: join(dir, "vault.json"), key: randomBytes(32)});
        svc = createContentService({storage, audit, secrets});
        resolver = createQueryResolver({content: svc});

        const type = await svc.createType(ADMIN, {
            name: "Article",
            slug: "article",
            fields: [
                {id: "1", name: "title", type: "text", required: true},
                {id: "2", name: "body", type: "text", required: false},
                {id: "3", name: "ssn", type: "text", required: false, sensitive: true},
            ],
        });
        const published = await svc.createEntry(EDITOR, {
            typeId: type.id, slug: "elephants", authorId: "u1",
            fields: {title: "All about Elephants", body: "Elephants are the largest land animals.", ssn: "111-22-3333"},
            blocks: [{type: "paragraph", content: "They have remarkable memory."}],
        });
        await svc.transition(EDITOR, published.id, "published");
        // A draft that must NOT appear in public search.
        await svc.createEntry(EDITOR, {
            typeId: type.id, slug: "secret-draft", authorId: "u1",
            fields: {title: "Draft about Elephants", body: "hidden"},
        });
    });

    afterEach(async () => {
        storage.close();
        await rm(dir, {recursive: true, force: true});
    });

    it("finds published content by title and body, with an excerpt", async () => {
        const byTitle = await resolver.search("elephants");
        expect(byTitle).toHaveLength(1);
        expect(byTitle[0]!.slug).toBe("elephants");
        expect(byTitle[0]!.excerpt.toLowerCase()).toContain("elephant");

        const byBlock = await resolver.search("remarkable memory");
        expect(byBlock.map((h) => h.slug)).toEqual(["elephants"]);
    });

    it("excludes drafts and never indexes sensitive (encrypted) fields", async () => {
        // The draft also says "Elephants" but must not surface in public search.
        const hits = await resolver.search("elephants");
        expect(hits.some((h) => h.slug === "secret-draft")).toBe(false);
        // The SSN value is encrypted at rest, so it is not searchable.
        expect(await resolver.search("111-22-3333")).toEqual([]);
    });

    it("returns nothing for an empty query", async () => {
        expect(await resolver.search("   ")).toEqual([]);
    });
});
