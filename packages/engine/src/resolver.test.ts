import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capabilitiesForRoles,
  createFileAuditLog,
  createFileSystemStorage,
} from "@pressh/core";
import type { AuditLog, StorageAdapter } from "@pressh/core";
import { createContentService, createQueryResolver, parsePath } from "@pressh/engine";
import type { ContentService, QueryResolver } from "@pressh/engine";

const ADMIN = capabilitiesForRoles(["admin"]);
const EDITOR = capabilitiesForRoles(["editor"]);
const VIEWER = capabilitiesForRoles(["viewer"]); // has content.read

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
