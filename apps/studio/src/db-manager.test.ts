import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {access, mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {AuditLog, StorageAdapter} from "@pressh/core";
import {createFileAuditLog, createFileSystemStorage, loadStorageConfig, saveStorageConfig} from "@pressh/core";
import {createSqliteStorage} from "@pressh/adapter-sqlite";
import type {DbManagerService} from "./db-manager";
import {createDbManager} from "./db-manager";
import {createMigrationLock} from "./migration-lock";
import {STORAGE_FACTORIES} from "./storage";

let dir: string;
let source: StorageAdapter;
let audit: AuditLog;
let lock = createMigrationLock();
let storageConfigPath: string;

async function exists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function makeManager(): DbManagerService {
    return createDbManager({
        factories: STORAGE_FACTORIES,
        storage: source,
        audit,
        migrationLock: lock,
        contentRoot: join(dir, "content"),
        mediaRoot: join(dir, "media"),
        auditPath: join(dir, "audit.log"),
        vaultPath: join(dir, "vault.json"),
        storageConfigPath,
        backupsDir: join(dir, "backups"),
        maintenancePropagationMs: 0,
    });
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-dbmgr-"));
    storageConfigPath = join(dir, "storage.json");
    source = createFileSystemStorage({root: join(dir, "content")});
    audit = await createFileAuditLog({path: join(dir, "audit.log")});
    lock = createMigrationLock();
    // Seed a few records across collections.
    for (let i = 0; i < 3; i++) await source.put("content_entries", {id: `e${i}`, slug: `p${i}`, status: "published"});
    await source.put("users", {id: "u1", email: "a@b.c"});
});

afterEach(async () => {
    source.close();
    await rm(dir, {recursive: true, force: true});
});

describe("DbManager migration (fs → sqlite)", () => {
    it("copies, verifies, backs up, writes config, and retains the old store", async () => {
        const mgr = makeManager();
        const sqlitePath = join(dir, "pressh.sqlite");
        const run = mgr.startMigration("admin", {backend: "sqlite", values: {path: sqlitePath}});
        expect(run.to).toBe("sqlite");
        await mgr.whenSettled();

        const status = mgr.migrationStatus();
        expect(status?.phase).toBe("awaiting-restart");
        expect(status?.error).toBeNull();
        // 4 seeded records + the `settings` doc written when maintenance was engaged.
        expect(status?.records).toBe(5);

        // storage.json now points at the sqlite backend.
        const cfg = await loadStorageConfig(storageConfigPath);
        expect(cfg?.backend).toBe("sqlite");
        expect(cfg?.options?.["path"]).toBe(sqlitePath);

        // The target holds the migrated data, with maintenance cleared.
        const target = createSqliteStorage({path: sqlitePath});
        const entries = await target.query("content_entries");
        expect(entries.ok && entries.value.items.length).toBe(3);
        const settings = await target.get<{ id: string; maintenanceMode?: boolean }>("settings", "general");
        expect(settings.ok && settings.value?.maintenanceMode).toBe(false);
        target.close();

        // A backup exists and a previous-store marker is retained for cleanup.
        expect(status?.backupPath).toBeTruthy();
        expect(await exists(status!.backupPath!)).toBe(true);
        const after = await mgr.status();
        expect(after.pendingCleanup?.backend).toBe("fs");
    });

    it("removes the old store on cleanup", async () => {
        const mgr = makeManager();
        mgr.startMigration("admin", {backend: "sqlite", values: {path: join(dir, "db.sqlite")}});
        await mgr.whenSettled();

        expect(await exists(join(dir, "content"))).toBe(true);
        const res = await mgr.cleanup("admin");
        expect(res.removed).toBe(true);
        expect(await exists(join(dir, "content"))).toBe(false);
        expect((await mgr.status()).pendingCleanup).toBeNull();
    });

    it("aborts and rolls back when the target already has data", async () => {
        const sqlitePath = join(dir, "occupied.sqlite");
        const pre = createSqliteStorage({path: sqlitePath});
        await pre.put("content_entries", {id: "existing", slug: "x"});
        pre.close();

        const mgr = makeManager();
        mgr.startMigration("admin", {backend: "sqlite", values: {path: sqlitePath}});
        await mgr.whenSettled();

        const status = mgr.migrationStatus();
        expect(status?.phase).toBe("failed");
        expect(status?.error).toMatch(/already contains data/i);
        // Rolled back: lock released, source maintenance cleared, config untouched.
        expect(lock.isLocked()).toBe(false);
        const src = await source.get<{ id: string; maintenanceMode?: boolean }>("settings", "general");
        expect(src.ok && (src.value?.maintenanceMode ?? false)).toBe(false);
        expect(await loadStorageConfig(storageConfigPath)).toBeNull();
    });

    it("rejects switching to the backend already in use", async () => {
        // The source is the fs backend (no storage.json), so a revert to fs is a no-op.
        const mgr = makeManager();
        mgr.startMigration("admin", {backend: "fs", values: {}});
        await mgr.whenSettled();
        const status = mgr.migrationStatus();
        expect(status?.phase).toBe("failed");
        expect(status?.error).toMatch(/already using/i);
        // Nothing changed: still on fs, content intact.
        expect(await loadStorageConfig(storageConfigPath)).toBeNull();
        expect(await exists(join(dir, "content"))).toBe(true);
    });

    it("anchors a relative sqlite path to the data dir (cwd-independent)", async () => {
        const mgr = makeManager();
        mgr.startMigration("admin", {backend: "sqlite", values: {path: "rel.sqlite"}});
        await mgr.whenSettled();
        expect(mgr.migrationStatus()?.phase).toBe("awaiting-restart");

        // storage.json keeps the path as entered (relative), and the file was
        // created under the data dir — NOT the process cwd.
        const cfg = await loadStorageConfig(storageConfigPath);
        expect(cfg?.options?.["path"]).toBe("rel.sqlite");
        expect(await exists(join(dir, "rel.sqlite"))).toBe(true);

        // A fresh adapter resolving that relative path against the data dir reads
        // the migrated data back — the symptom that was failing before the fix.
        const target = createSqliteStorage({path: join(dir, "rel.sqlite")});
        const entries = await target.query("content_entries");
        expect(entries.ok && entries.value.items.length).toBe(3);
        target.close();
    });

    it("refuses to remove the old store when the active store is missing data", async () => {
        const mgr = makeManager();
        mgr.startMigration("admin", {backend: "sqlite", values: {path: join(dir, "v.sqlite")}});
        await mgr.whenSettled();

        // Simulate a botched cutover where the now-active store came up empty.
        for (const col of ["content_entries", "users", "settings"]) {
            const page = await source.query(col);
            if (page.ok) for (const it of page.value.items) await source.delete(col, it.id);
        }
        const res = await mgr.cleanup("admin");
        expect(res.removed).toBe(false);
        expect(res.reason).toMatch(/expected records/i);
        // The old store is preserved as the only surviving copy.
        expect(await exists(join(dir, "content"))).toBe(true);
    });

    it("reverts from sqlite back to the File backend", async () => {
        // Build a sqlite-backed install with data, then revert it to File.
        const sqlitePath = join(dir, "live.sqlite");
        const sqliteSource = createSqliteStorage({path: sqlitePath});
        for (let i = 0; i < 4; i++) await sqliteSource.put("content_entries", {id: `e${i}`, slug: `p${i}`});
        await sqliteSource.put("users", {id: "u1", email: "a@b.c"});
        await saveStorageConfig(storageConfigPath, {backend: "sqlite", options: {path: sqlitePath}});

        const revertRoot = join(dir, "reverted");
        const mgr = createDbManager({
            factories: STORAGE_FACTORIES,
            storage: sqliteSource,
            audit,
            migrationLock: lock,
            contentRoot: revertRoot,
            mediaRoot: join(dir, "media"),
            auditPath: join(dir, "audit.log"),
            vaultPath: join(dir, "vault.json"),
            storageConfigPath,
            backupsDir: join(dir, "backups"),
            maintenancePropagationMs: 0,
        });

        mgr.startMigration("admin", {backend: "fs", values: {}});
        await mgr.whenSettled();
        const status = mgr.migrationStatus();
        expect(status?.phase).toBe("awaiting-restart");
        expect(status?.error).toBeNull();

        // storage.json now points at fs, and the data landed in the content root.
        const cfg = await loadStorageConfig(storageConfigPath);
        expect(cfg?.backend).toBe("fs");
        const reverted = createFileSystemStorage({root: revertRoot});
        const entries = await reverted.query("content_entries");
        expect(entries.ok && entries.value.items.length).toBe(4);
        reverted.close();

        // The previous sqlite store is retained for rollback.
        expect((await mgr.status()).pendingCleanup?.backend).toBe("sqlite");
        sqliteSource.close();
    });

    it("tests a connection without migrating", async () => {
        const mgr = makeManager();
        await expect(mgr.testConnection({
            backend: "sqlite",
            values: {path: join(dir, "probe.sqlite")}
        })).resolves.toEqual({
            ok: true,
        });
    });
});
