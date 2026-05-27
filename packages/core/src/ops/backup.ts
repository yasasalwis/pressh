import {cp, mkdir, mkdtemp, readdir, rm, stat} from "node:fs/promises";
import { existsSync } from "node:fs";
import {tmpdir} from "node:os";
import { basename, join, parse, resolve } from "node:path";
import { PressError } from "../errors.js";
import { err, ok } from "../result.js";
import type { Result } from "../result.js";
import {createFileSystemStorage} from "../storage/fs-adapter.js";
import type {Page, StoredDoc} from "../storage/types.js";

/** Timestamped backup folder prefix, e.g. `backup-2026-05-27T20-00-00-000Z`. */
const BACKUP_PREFIX = "backup-";
const DEFAULT_KEEP = 7;

/**
 * Backup/restore of an installation's on-disk state (RUNBOOK DR procedures).
 * Copies the content root, media, the secrets vault, and the audit log into a
 * backup directory; restore copies them back to a (possibly fresh) host.
 */
export interface BackupTargets {
  contentRoot: string;
  mediaRoot?: string;
  vaultPath?: string;
  auditPath?: string;
}

function items(targets: BackupTargets): { key: string; path: string }[] {
  const out: { key: string; path: string }[] = [{ key: "content", path: targets.contentRoot }];
  if (targets.mediaRoot) out.push({ key: "media", path: targets.mediaRoot });
  if (targets.vaultPath) out.push({ key: basename(targets.vaultPath), path: targets.vaultPath });
  if (targets.auditPath) out.push({ key: basename(targets.auditPath), path: targets.auditPath });
  return out;
}

/** Guards against a restore that would recursively delete a root/empty path. */
function assertSafeTarget(path: string): void {
  const abs = resolve(path);
  if (abs === parse(abs).root || abs.length <= 1) {
    throw new PressError("validation", `Refusing to operate on unsafe path: ${path}`);
  }
}

export async function createBackup(targets: BackupTargets, dest: string): Promise<Result<{ items: number }>> {
  try {
    // The backup set includes the secrets vault and audit log — restrict the
    // destination so other local users cannot read it.
    await mkdir(dest, { recursive: true, mode: 0o700 });
    let count = 0;
    for (const item of items(targets)) {
      if (!existsSync(item.path)) continue;
      await cp(item.path, join(dest, item.key), { recursive: true });
      count += 1;
    }
    return ok({ items: count });
  } catch (e) {
    return err(new PressError("internal", e instanceof Error ? e.message : "Backup failed"));
  }
}

export async function restoreBackup(src: string, targets: BackupTargets): Promise<Result<{ items: number }>> {
  try {
    let count = 0;
    for (const item of items(targets)) {
      const from = join(src, item.key);
      if (!existsSync(from)) continue;
      assertSafeTarget(item.path);
      await rm(item.path, { recursive: true, force: true });
      await cp(from, item.path, { recursive: true });
      count += 1;
    }
    return ok({ items: count });
  } catch (e) {
    return err(new PressError("internal", e instanceof Error ? e.message : "Restore failed"));
  }
}

// ---------------------------------------------------------------------------
// Scheduled backups + retention + restore drill (RUNBOOK DR automation)
// ---------------------------------------------------------------------------

export interface BackupInfo {
    /** Folder name, e.g. `backup-2026-05-27T20-00-00-000Z`. */
    name: string;
    path: string;
    /** Folder mtime as an ISO string. */
    createdAt: string;
    sizeBytes: number;
}

async function dirSize(path: string): Promise<number> {
    let total = 0;
    const entries = await readdir(path, {withFileTypes: true}).catch(() => []);
    for (const e of entries) {
        const p = join(path, e.name);
        if (e.isDirectory()) total += await dirSize(p);
        else {
            const s = await stat(p).catch(() => null);
            if (s) total += s.size;
        }
    }
    return total;
}

/** Lists timestamped backups in a directory, newest first. */
export async function listBackups(backupDir: string): Promise<Result<BackupInfo[]>> {
    try {
        if (!existsSync(backupDir)) return ok([]);
        const entries = await readdir(backupDir, {withFileTypes: true});
        const infos: BackupInfo[] = [];
        for (const e of entries) {
            if (!e.isDirectory() || !e.name.startsWith(BACKUP_PREFIX)) continue;
            const path = join(backupDir, e.name);
            const s = await stat(path);
            infos.push({name: e.name, path, createdAt: s.mtime.toISOString(), sizeBytes: await dirSize(path)});
        }
        // The name embeds an ISO timestamp, so lexical descending == newest first.
        infos.sort((a, b) => (a.name < b.name ? 1 : -1));
        return ok(infos);
    } catch (e) {
        return err(new PressError("internal", e instanceof Error ? e.message : "List backups failed"));
    }
}

/** Removes all but the newest `keep` backups. */
export async function pruneBackups(backupDir: string, keep: number): Promise<Result<{ removed: number }>> {
    try {
        const listed = await listBackups(backupDir);
        if (!listed.ok) return listed;
        const stale = listed.value.slice(Math.max(0, keep));
        for (const b of stale) await rm(b.path, {recursive: true, force: true});
        return ok({removed: stale.length});
    } catch (e) {
        return err(new PressError("internal", e instanceof Error ? e.message : "Prune failed"));
    }
}

export interface ScheduledBackupOptions {
    targets: BackupTargets;
    backupDir: string;
    /** How many backups to retain (default 7). */
    keep?: number;
    now?: () => number;
}

/** Creates a timestamped backup and prunes old ones to the retention limit. */
export async function runScheduledBackup(
    opts: ScheduledBackupOptions,
): Promise<Result<{ name: string; items: number; pruned: number }>> {
    const now = opts.now ?? (() => Date.now());
    const keep = opts.keep ?? DEFAULT_KEEP;
    const name = `${BACKUP_PREFIX}${new Date(now()).toISOString().replace(/[:.]/g, "-")}`;
    const made = await createBackup(opts.targets, join(opts.backupDir, name));
    if (!made.ok) return made;
    const pruned = await pruneBackups(opts.backupDir, keep);
    if (!pruned.ok) return pruned;
    return ok({name, items: made.value.items, pruned: pruned.value.removed});
}

export interface BackupVerification {
    /** True when the backup's content store restored and holds records. */
    ok: boolean;
    collections: Record<string, number>;
    totalRecords: number;
    message: string;
}

/**
 * Restore drill: restores the backup's content store into a TEMPORARY directory
 * (never the live store) and counts records, proving the backup is structurally
 * restorable. Read-only with respect to the running installation.
 */
export async function verifyBackup(backupPath: string): Promise<Result<BackupVerification>> {
    const contentSrc = join(backupPath, "content");
    if (!existsSync(contentSrc)) {
        return ok({ok: false, collections: {}, totalRecords: 0, message: "Backup contains no content store."});
    }
    const tmp = await mkdtemp(join(tmpdir(), "pressh-verify-"));
    try {
        const root = join(tmp, "content");
        await cp(contentSrc, root, {recursive: true});
        const storage = createFileSystemStorage({root});
        try {
            const cols = await storage.listCollections();
            if (!cols.ok) return err(cols.error);
            const collections: Record<string, number> = {};
            let total = 0;
            for (const col of cols.value) {
                let count = 0;
                let cursor: string | null = null;
                do {
                    const page: Result<Page<StoredDoc>> = await storage.query<StoredDoc>(
                        col,
                        {},
                        {limit: 500, after: cursor},
                    );
                    if (!page.ok) break;
                    count += page.value.items.length;
                    cursor = page.value.nextCursor;
                } while (cursor !== null);
                collections[col] = count;
                total += count;
            }
            return ok({
                ok: total > 0,
                collections,
                totalRecords: total,
                message:
                    total > 0
                        ? "Backup restored into a sandbox and verified."
                        : "Backup restored but contains no records.",
            });
        } finally {
            storage.close();
        }
    } catch (e) {
        return err(new PressError("internal", e instanceof Error ? e.message : "Verify failed"));
    } finally {
        await rm(tmp, {recursive: true, force: true});
    }
}

/**
 * Pluggable destination for scheduled backups. The filesystem target ships in
 * core; an offsite target (e.g. S3) is a drop-in that implements this same shape
 * (point `PRESSH_BACKUP_DIR` at a mounted offsite volume to use the FS target
 * offsite without any new dependency).
 */
export interface BackupTarget {
    store(targets: BackupTargets): Promise<Result<{ name: string; items: number; pruned: number }>>;

    list(): Promise<Result<BackupInfo[]>>;
}

export function createFilesystemBackupTarget(cfg: {
    dir: string;
    keep?: number;
    now?: () => number;
}): BackupTarget {
    return {
        store: (targets) =>
            runScheduledBackup({
                targets,
                backupDir: cfg.dir,
                ...(cfg.keep !== undefined ? {keep: cfg.keep} : {}),
                ...(cfg.now ? {now: cfg.now} : {}),
            }),
        list: () => listBackups(cfg.dir),
    };
}
