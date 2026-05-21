import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileAuditLog } from "@pressh/core";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-audit-"));
  path = join(dir, "audit.log");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileAuditLog", () => {
  it("appends entries with a genesis prevHash on the first record", async () => {
    const log = await createFileAuditLog({ path });
    const entry = await log.append({ action: "user.login", actorId: "u1" });
    expect(entry.prevHash).toBe("");
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains hashes and verifies a clean chain", async () => {
    const log = await createFileAuditLog({ path });
    const a = await log.append({ action: "a", actorId: "u1" });
    const b = await log.append({ action: "b", actorId: "u1" });
    expect(b.prevHash).toBe(a.hash);
    expect(await log.verifyChain()).toBe(true);
  });

  it("detects tampering", async () => {
    const log = await createFileAuditLog({ path });
    await log.append({ action: "a", actorId: "u1" });
    await log.append({ action: "b", actorId: "u2" });
    expect(await log.verifyChain()).toBe(true);

    const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
    const first = JSON.parse(lines[0]!) as { action: string };
    first.action = "TAMPERED";
    lines[0] = JSON.stringify(first);
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");

    expect(await log.verifyChain()).toBe(false);
  });

  it("redacts sensitive fields in detail", async () => {
    const log = await createFileAuditLog({ path });
    const entry = await log.append({
      action: "secret.set",
      actorId: "u1",
      detail: { name: "stripe", password: "should-not-appear" },
    });
    expect(entry.detail["password"]).toBe("[REDACTED]");
    expect(entry.detail["name"]).toBe("stripe");
  });

  it("queries by action, actor, and limit", async () => {
    const log = await createFileAuditLog({ path });
    await log.append({ action: "x", actorId: "u1" });
    await log.append({ action: "y", actorId: "u2" });
    await log.append({ action: "x", actorId: "u2" });

    expect(await log.query({ action: "x" })).toHaveLength(2);
    expect(await log.query({ actorId: "u2" })).toHaveLength(2);
    expect(await log.query({ limit: 1 })).toHaveLength(1);
  });

  it("resumes the chain after reopening the log", async () => {
    const first = await createFileAuditLog({ path });
    const a = await first.append({ action: "a", actorId: "u1" });

    const reopened = await createFileAuditLog({ path });
    const b = await reopened.append({ action: "b", actorId: "u1" });
    expect(b.prevHash).toBe(a.hash);
    expect(await reopened.verifyChain()).toBe(true);
  });
});
