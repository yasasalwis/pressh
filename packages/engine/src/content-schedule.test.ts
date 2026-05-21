import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capabilitiesForRoles,
  createFileAuditLog,
  createFileSystemStorage,
  createScheduler,
} from "@pressh/core";
import type { AuditLog, StorageAdapter } from "@pressh/core";
import { PUBLISH_JOB_TYPE, createContentService } from "@pressh/engine";

const ADMIN = capabilitiesForRoles(["admin"]);
const EDITOR = capabilitiesForRoles(["editor"]);

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;
let clock: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-content-sched-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  clock = 1_000_000;
});
afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("scheduled publish", () => {
  it("auto-publishes a scheduled entry when the job fires", async () => {
    const scheduler = createScheduler({ storage, audit, now: () => clock });
    const content = createContentService({ storage, audit, now: () => clock, scheduler });
    scheduler.register(PUBLISH_JOB_TYPE, async (payload) => {
      const entryId = (payload as { entryId: string }).entryId;
      await content.transition(["content.publish"], entryId, "published");
    });

    const type = await content.createType(ADMIN, {
      name: "Page",
      slug: "page",
      fields: [{ id: "1", name: "title", type: "text", required: true }],
    });
    const entry = await content.createEntry(EDITOR, {
      typeId: type.id,
      slug: "soon",
      authorId: "u1",
      fields: { title: "Soon" },
    });
    await content.transition(EDITOR, entry.id, "scheduled", {
      scheduledFor: new Date(clock + 1000).toISOString(),
    });

    // Not due yet.
    expect((await scheduler.tick()).ran).toBe(0);
    expect((await content.getEntry(entry.id))?.status).toBe("scheduled");

    // Advance past the scheduled time → the job publishes it.
    clock += 2000;
    expect((await scheduler.tick()).ran).toBe(1);
    expect((await content.getEntry(entry.id))?.status).toBe("published");
  });
});
