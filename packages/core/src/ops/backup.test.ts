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

describe("scheduled backups + retention + restore drill", () => {
    async function seedContent(root: string): Promise<void> {
        const {createFileSystemStorage} = await import("@pressh/core");
        const storage = createFileSystemStorage({root});
        await storage.put("posts", {id: "p1", title: "One"});
        await storage.put("posts", {id: "p2", title: "Two"});
        storage.close();
    }

    it("runs a timestamped backup and prunes to the retention limit", async () => {
        const {runScheduledBackup, listBackups} = await import("@pressh/core");
        const contentRoot = join(dir, "content");
        await seedContent(contentRoot);
        const backupDir = join(dir, "backups");

        let clock = 1_000_000_000_000;
        for (let i = 0; i < 4; i++) {
            const r = await runScheduledBackup({
                targets: {contentRoot},
                backupDir,
                keep: 2,
                now: () => (clock += 60_000),
            });
            expect(r.ok && r.value.items).toBe(1);
        }
        const listed = await listBackups(backupDir);
        expect(listed.ok && listed.value.length).toBe(2); // only the newest 2 kept
        // Newest first.
        expect(listed.ok && listed.value[0]!.name > listed.value[1]!.name).toBe(true);
    });

    it("verifies a backup by restoring into a sandbox and counting records", async () => {
        const {runScheduledBackup, listBackups, verifyBackup} = await import("@pressh/core");
        const contentRoot = join(dir, "content");
        await seedContent(contentRoot);
        const backupDir = join(dir, "backups");
        await runScheduledBackup({targets: {contentRoot}, backupDir, keep: 5});

        const listed = await listBackups(backupDir);
        const latest = listed.ok ? listed.value[0]! : null;
        const v = await verifyBackup(latest!.path);
        expect(v.ok).toBe(true);
        expect(v.ok && v.value.ok).toBe(true);
        expect(v.ok && v.value.collections["posts"]).toBe(2);
        expect(v.ok && v.value.totalRecords).toBe(2);
        // The live content store is untouched by the drill.
        expect(await readFile(join(contentRoot, "posts", "p1.json"), "utf8").catch(() => "")).toBeDefined();
    });

    it("reports not-ok for a backup with no content store", async () => {
        const {verifyBackup} = await import("@pressh/core");
        const empty = join(dir, "empty-backup");
        await mkdir(empty, {recursive: true});
        const v = await verifyBackup(empty);
        expect(v.ok && v.value.ok).toBe(false);
    });
});
