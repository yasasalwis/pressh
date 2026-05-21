import { join } from "node:path";
import { createBackup, createFileSystemStorage, restoreBackup } from "@pressh/core";

/**
 * `pressh` operations CLI (RUNBOOK maintenance/DR). Thin wrapper over the
 * tested core helpers. Reads paths from env; backup destination from argv.
 *
 *   node dist/cli.js backup [dest]
 *   node dist/cli.js restore [src]
 *   node dist/cli.js index:rebuild
 */
function out(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  const contentRoot = process.env["PRESSH_CONTENT_ROOT"] ?? "./content";
  const mediaRoot = process.env["PRESSH_MEDIA_ROOT"] ?? "./media";
  const vaultPath = process.env["PRESSH_VAULT_PATH"] ?? join(contentRoot, "..", "vault.json");
  const auditPath = join(contentRoot, "..", "audit.log");
  const targets = { contentRoot, mediaRoot, vaultPath, auditPath };

  switch (command) {
    case "backup": {
      const result = await createBackup(targets, arg ?? "./backup");
      if (!result.ok) throw result.error;
      out(`Backed up ${result.value.items} item(s) to ${arg ?? "./backup"}`);
      break;
    }
    case "restore": {
      const result = await restoreBackup(arg ?? "./backup", targets);
      if (!result.ok) throw result.error;
      out(`Restored ${result.value.items} item(s)`);
      break;
    }
    case "index:rebuild": {
      const storage = createFileSystemStorage({ root: contentRoot });
      const result = await storage.rebuildIndex();
      storage.close();
      if (!result.ok) throw result.error;
      out("Index rebuilt from canonical files");
      break;
    }
    default:
      throw new Error(`Unknown command: ${command ?? "(none)"}. Use backup | restore | index:rebuild`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
