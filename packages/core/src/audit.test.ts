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

describe("FileAuditLog — sealed tamper-evidence anchor", () => {
    const SEAL = "test-seal-secret";

    async function seedSealed(n: number) {
        const log = await createFileAuditLog({path, sealSecret: SEAL});
        for (let i = 0; i < n; i++) await log.append({action: `a${i}`, actorId: "u1"});
        return log;
    }

    it("verifies a clean sealed chain", async () => {
        const log = await seedSealed(3);
        expect(await log.verifyChain()).toBe(true);
    });

    it("detects truncation of the tail (which an internal-only check misses)", async () => {
        const log = await seedSealed(3);
        const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
        // Drop the last entry. The remaining chain is still internally consistent…
        await writeFile(path, `${lines.slice(0, -1).join("\n")}\n`, "utf8");
        // …but the seal records 3 entries, so the count mismatch is caught.
        expect(await log.verifyChain()).toBe(false);
    });

    it("detects a fully re-forged chain rebuilt from genesis", async () => {
        const log = await seedSealed(2);
        // A fresh, internally-valid chain the attacker recomputes (genesis prevHash,
        // self-consistent hashes) — but it can't reproduce the sealed head, and the
        // seal MAC can't be forged without the key.
        const forged = await createFileAuditLog({path: join(dir, "forge.log")});
        await forged.append({action: "evil", actorId: "attacker"});
        const forgedLine = (await readFile(join(dir, "forge.log"), "utf8")).trim();
        await writeFile(path, `${forgedLine}\n`, "utf8");
        expect(await log.verifyChain()).toBe(false);
    });

    it("detects deletion of the seal file while entries remain", async () => {
        const log = await seedSealed(2);
        await rm(`${path}.seal`, {force: true});
        expect(await log.verifyChain()).toBe(false);
    });

    it("without a seal secret, truncation is NOT detected (anchor disabled, backward compatible)", async () => {
        const log = await createFileAuditLog({path}); // no sealSecret
        for (let i = 0; i < 3; i++) await log.append({action: `a${i}`, actorId: "u1"});
        const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
        await writeFile(path, `${lines.slice(0, -1).join("\n")}\n`, "utf8");
        // Internal chain is still consistent and there is no anchor to catch it.
        expect(await log.verifyChain()).toBe(true);
    });
});
