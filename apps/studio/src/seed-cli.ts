import {createFileAuditLog} from "@pressh/core";
import {join} from "node:path";
import {openConfiguredStorage, parseMasterKey} from "./bootstrap.js";
import {seedOwner} from "./seed.js";

/**
 * `npm run seed -w @pressh/studio` — creates the first Owner account.
 * Reads PRESSH_CONTENT_ROOT / PRESSH_SEED_EMAIL / PRESSH_SEED_PASSWORD from env.
 *
 * Seeds into the SAME backend the server uses: if `storage.json` selects a
 * database, the Owner is created there (not on the filesystem), so a DB-backed
 * install isn't left with an admin account the running app can't see.
 */
async function main(): Promise<void> {
    // Honor a project-root .env (dev). Real env vars take precedence; missing file is fine.
    try {
        process.loadEnvFile();
    } catch { /* no .env — rely on the real environment */
    }
  const contentRoot = process.env["PRESSH_CONTENT_ROOT"] ?? "./data/content";
  const email = process.env["PRESSH_SEED_EMAIL"];
  const password = process.env["PRESSH_SEED_PASSWORD"];
  if (!email || !password) {
    throw new Error("Set PRESSH_SEED_EMAIL and PRESSH_SEED_PASSWORD");
  }
    const masterKey = parseMasterKey(process.env["PRESSH_MASTER_KEY"]);
    const {storage} = await openConfiguredStorage({
        contentRoot,
        ...(masterKey ? {masterKey} : {}),
    });
    const audit = await createFileAuditLog({
        path: join(contentRoot, "..", "audit.log"),
        ...(process.env["PRESSH_MASTER_KEY"] ? {sealSecret: process.env["PRESSH_MASTER_KEY"]} : {}),
    });
  const user = await seedOwner({ storage, audit, email, password });
  storage.close();
  process.stdout.write(`Owner ready: ${user.email} (${user.id})\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
