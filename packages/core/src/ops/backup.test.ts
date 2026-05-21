import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup, restoreBackup } from "@pressh/core";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-backup-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("backup/restore", () => {
  it("backs up and restores content + vault to a fresh location", async () => {
    const contentRoot = join(dir, "content");
    const vaultPath = join(dir, "vault.json");
    await mkdir(join(contentRoot, "posts"), { recursive: true });
    await writeFile(join(contentRoot, "posts", "p1.json"), '{"id":"p1"}', "utf8");
    await writeFile(vaultPath, '{"version":1}', "utf8");

    const targets = { contentRoot, vaultPath };
    const backupDir = join(dir, "backup");
    const made = await createBackup(targets, backupDir);
    expect(made.ok && made.value.items).toBe(2);

    // Wipe the originals (simulate a fresh host).
    await rm(contentRoot, { recursive: true, force: true });
    await rm(vaultPath, { force: true });

    const restored = await restoreBackup(backupDir, targets);
    expect(restored.ok).toBe(true);
    expect(await readFile(join(contentRoot, "posts", "p1.json"), "utf8")).toContain("p1");
    expect(await readFile(vaultPath, "utf8")).toContain("version");
  });
});
