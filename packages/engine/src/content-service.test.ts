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
import { createContentService } from "@pressh/engine";
import type { ContentService, ContentType } from "@pressh/engine";

const EDITOR = capabilitiesForRoles(["editor"]); // create/update/submit/publish
const AUTHOR = capabilitiesForRoles(["author"]); // create/update/submit, NOT publish
const ADMIN = capabilitiesForRoles(["admin"]); // includes types.manage

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;
let svc: ContentService;
let type: ContentType;

async function makeType(): Promise<ContentType> {
  return svc.createType(ADMIN, {
    name: "Post",
    slug: "post",
    fields: [
      { id: "1", name: "title", type: "text", required: true },
      { id: "2", name: "tier", type: "select", required: false, options: ["free", "pro"] },
    ],
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-engine-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  svc = createContentService({ storage, audit });
  type = await makeType();
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("ContentService", () => {
  it("requires types.manage to create a type", async () => {
    await expect(
      svc.createType(AUTHOR, { name: "X", slug: "x", fields: [] }),
    ).rejects.toMatchObject({ code: "capability_denied" });
  });

  it("creates an entry with a first revision and validates fields", async () => {
    const entry = await svc.createEntry(AUTHOR, {
      typeId: type.id,
      slug: "hello-world",
      authorId: "u1",
      fields: { title: "Hello", tier: "pro" },
    });
    expect(entry.status).toBe("draft");
    expect(entry.currentRevision).toBe(1);
    const rev = await svc.getRevision(entry.id, 1);
    expect(rev?.fields["title"]).toBe("Hello");
  });

  it("rejects invalid field data on create", async () => {
    await expect(
      svc.createEntry(AUTHOR, {
        typeId: type.id,
        slug: "bad",
        authorId: "u1",
        fields: { tier: "pro" }, // missing required title
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("creates a new revision on each save", async () => {
    const entry = await svc.createEntry(AUTHOR, {
      typeId: type.id,
      slug: "post-1",
      authorId: "u1",
      fields: { title: "v1" },
    });
    const saved = await svc.saveEntry(AUTHOR, entry.id, { fields: { title: "v2" }, editorId: "u1" });
    expect(saved.currentRevision).toBe(2);
    expect((await svc.listRevisions(entry.id)).map((r) => r.version)).toEqual([1, 2]);
  });

  it("publishes via transition and enforces capabilities", async () => {
    const entry = await svc.createEntry(AUTHOR, {
      typeId: type.id,
      slug: "to-publish",
      authorId: "u1",
      fields: { title: "x" },
    });
    // Author cannot publish.
    await expect(svc.transition(AUTHOR, entry.id, "published")).rejects.toMatchObject({
      code: "capability_denied",
    });
    // Editor can.
    const published = await svc.transition(EDITOR, entry.id, "published");
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();
  });

  it("denies illegal transitions", async () => {
    const entry = await svc.createEntry(AUTHOR, {
      typeId: type.id,
      slug: "illegal",
      authorId: "u1",
      fields: { title: "x" },
    });
    await svc.transition(EDITOR, entry.id, "published");
    await svc.transition(EDITOR, entry.id, "archived");
    await expect(svc.transition(EDITOR, entry.id, "published")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("restoring a revision creates a new revision", async () => {
    const entry = await svc.createEntry(AUTHOR, {
      typeId: type.id,
      slug: "restore-me",
      authorId: "u1",
      fields: { title: "original" },
    });
    await svc.saveEntry(AUTHOR, entry.id, { fields: { title: "edited" }, editorId: "u1" });
    const restored = await svc.restoreRevision(EDITOR, entry.id, 1, "u1");
    expect(restored.currentRevision).toBe(3);
    const rev3 = await svc.getRevision(entry.id, 3);
    expect(rev3?.fields["title"]).toBe("original");
  });

  it("treats locale variants as independent entries", async () => {
    await svc.createEntry(AUTHOR, {
      typeId: type.id,
      slug: "about",
      locale: "en",
      authorId: "u1",
      fields: { title: "About" },
    });
    const fr = await svc.createEntry(AUTHOR, {
      typeId: type.id,
      slug: "about",
      locale: "fr",
      authorId: "u1",
      fields: { title: "À propos" },
    });
    await svc.transition(EDITOR, fr.id, "published");

    expect((await svc.resolveBySlug("about", "fr", { publicOnly: true }))?.locale).toBe("fr");
    // The English variant is still a draft — invisible to the public.
    expect(await svc.resolveBySlug("about", "en", { publicOnly: true })).toBeNull();
  });

  it("rejects a duplicate slug+locale", async () => {
    await svc.createEntry(AUTHOR, {
      typeId: type.id,
      slug: "dup",
      authorId: "u1",
      fields: { title: "a" },
    });
    await expect(
      svc.createEntry(AUTHOR, {
        typeId: type.id,
        slug: "dup",
        authorId: "u1",
        fields: { title: "b" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
