import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthService, createFileAuditLog, createFileSystemStorage } from "@pressh/core";
import type { AuditLog, StorageAdapter } from "@pressh/core";
import { seedOwner } from "./seed";

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-seed-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
});
afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("seedOwner", () => {
  it("creates an owner who can authenticate", async () => {
    const user = await seedOwner({ storage, audit, email: "owner@x.com", password: "ownerpass1" });
    expect(user.roles).toEqual(["owner"]);
    const auth = await createAuthService({ storage, audit });
    await expect(auth.authenticate({ email: "owner@x.com", password: "ownerpass1" })).resolves.toBeDefined();
  });

  it("is idempotent", async () => {
    const first = await seedOwner({ storage, audit, email: "owner@x.com", password: "ownerpass1" });
    const second = await seedOwner({ storage, audit, email: "owner@x.com", password: "different" });
    expect(second.id).toBe(first.id);
  });
});
