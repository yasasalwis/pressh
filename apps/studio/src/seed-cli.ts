import { join } from "node:path";
import { createFileAuditLog, createFileSystemStorage } from "@pressh/core";
import { seedOwner } from "./seed.js";

/**
 * `npm run seed -w @pressh/studio` — creates the first Owner account.
 * Reads PRESSH_CONTENT_ROOT / PRESSH_SEED_EMAIL / PRESSH_SEED_PASSWORD from env.
 */
async function main(): Promise<void> {
  const contentRoot = process.env["PRESSH_CONTENT_ROOT"] ?? "./data/content";
  const email = process.env["PRESSH_SEED_EMAIL"];
  const password = process.env["PRESSH_SEED_PASSWORD"];
  if (!email || !password) {
    throw new Error("Set PRESSH_SEED_EMAIL and PRESSH_SEED_PASSWORD");
  }
  const storage = createFileSystemStorage({ root: contentRoot });
  const audit = await createFileAuditLog({ path: join(contentRoot, "..", "audit.log") });
  const user = await seedOwner({ storage, audit, email, password });
  storage.close();
  process.stdout.write(`Owner ready: ${user.email} (${user.id})\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
