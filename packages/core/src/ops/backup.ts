import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, parse, resolve } from "node:path";
import { PressError } from "../errors.js";
import { err, ok } from "../result.js";
import type { Result } from "../result.js";

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
