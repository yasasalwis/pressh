import { createAuthService } from "@pressh/core";
import type { AuditLog, StorageAdapter, User } from "@pressh/core";

/**
 * Bootstraps the first Owner account. Idempotent: if a user with the email
 * already exists it is returned unchanged. Used by the `seed` CLI on first run.
 */
export async function seedOwner(opts: {
  storage: StorageAdapter;
  audit: AuditLog;
  email: string;
  password: string;
}): Promise<User> {
  const auth = await createAuthService({ storage: opts.storage, audit: opts.audit });
  const existing = await auth.getUserByEmail(opts.email);
  if (existing) return existing;
  return auth.createUser({ email: opts.email, password: opts.password, roles: ["owner"] });
}
