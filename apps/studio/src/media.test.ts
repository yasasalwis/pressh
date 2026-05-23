import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileAuditLog, createFileSystemStorage } from "@pressh/core";
import type { AuditLog, StorageAdapter } from "@pressh/core";
import { createMediaService, validateUpload } from "./media";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const DISGUISED = new TextEncoder().encode("#!/bin/sh\nrm -rf /");

describe("validateUpload", () => {
  it("accepts a real PNG", () => {
    expect(validateUpload("logo.png", "image/png", PNG)).toEqual({ ext: "png", mime: "image/png" });
  });
  it("rejects a disguised executable (magic-byte mismatch)", () => {
    expect(() => validateUpload("evil.png", "image/png", DISGUISED)).toThrowError(/disguised/i);
  });
  it("rejects a disallowed extension", () => {
    expect(() => validateUpload("malware.exe", "application/octet-stream", PNG)).toThrow();
  });
  it("rejects a content-type mismatch", () => {
    expect(() => validateUpload("logo.png", "text/plain", PNG)).toThrow();
  });
});

describe("MediaService", () => {
  let dir: string;
  let storage: StorageAdapter;
  let audit: AuditLog;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-media-"));
    storage = createFileSystemStorage({ root: join(dir, "content") });
    audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  });
  afterEach(async () => {
    storage.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("stores a valid file outside the content root and records it", async () => {
    const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
    const record = await media.store("logo.png", "image/png", PNG, "u1");
    expect(record.ext).toBe("png");
    expect(record.path).toContain(join(dir, "media"));
    expect((await audit.query({ action: "media.upload" })).length).toBe(1);
  });

  it("rejects a disguised upload", async () => {
    const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
    await expect(media.store("evil.png", "image/png", DISGUISED, "u1")).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("lists stored media newest-first and fetches by id", async () => {
    const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
    const first = await media.store("a.png", "image/png", PNG, "u1");
    await new Promise((r) => setTimeout(r, 5));
    const second = await media.store("b.png", "image/png", PNG, "u1");
    const list = await media.list();
    expect(list.map((m) => m.id)).toEqual([second.id, first.id]);
    expect((await media.get(first.id))?.filename).toBe("a.png");
    expect(await media.get("nope")).toBeNull();
  });

  it("deletes media (file + record + audit)", async () => {
    const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
    const rec = await media.store("c.png", "image/png", PNG, "u1");
    await media.delete(rec.id, "u1");
    expect(await media.get(rec.id)).toBeNull();
    const { readFile } = await import("node:fs/promises");
    await expect(readFile(rec.path)).rejects.toBeDefined(); // blob gone
    expect((await audit.query({ action: "media.delete" })).length).toBe(1);
    await expect(media.delete("nope", "u1")).rejects.toMatchObject({ code: "not_found" });
  });
});
