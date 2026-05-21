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

const ADMIN = capabilitiesForRoles(["admin"]);
const AUTHOR = capabilitiesForRoles(["author"]); // lacks content.rawhtml

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;
let svc: ContentService;
let type: ContentType;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-blocks-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  svc = createContentService({ storage, audit });
  type = await svc.createType(ADMIN, {
    name: "Post",
    slug: "post",
    fields: [{ id: "1", name: "title", type: "text", required: true }],
  });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("content service block sanitization", () => {
  it("stores sanitized blocks on create", async () => {
    const entry = await svc.createEntry(AUTHOR, {
      typeId: type.id,
      slug: "post-1",
      authorId: "u1",
      fields: { title: "t" },
      blocks: [{ type: "paragraph", content: "safe<script>alert(1)</script>" }],
    });
    const rev = await svc.getRevision(entry.id, 1);
    expect((rev?.blocks[0] as { content: string }).content).toBe("safe");
  });

  it("rejects an entry containing a raw-HTML block without the capability", async () => {
    await expect(
      svc.createEntry(AUTHOR, {
        typeId: type.id,
        slug: "post-2",
        authorId: "u1",
        fields: { title: "t" },
        blocks: [{ type: "html", content: "<p>raw</p>" }],
      }),
    ).rejects.toMatchObject({ code: "capability_denied" });

    // And no dangling entry was persisted.
    expect(await svc.resolveBySlug("post-2")).toBeNull();
  });
});
