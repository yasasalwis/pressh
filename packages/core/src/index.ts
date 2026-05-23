/**
 * @pressh/core — kernel package.
 *
 * Phase 1: typed Result/error model, async hook bus, default-deny capability
 * gate, redacting logger, config loader. Secrets vault, audit log, auth/RBAC,
 * storage interface, and scheduler land in Phases 2–4.
 */
export const PRESSH_CORE_VERSION = "0.0.0";

export { PressError } from "./errors.js";
export type { ErrorCode } from "./errors.js";

export { ok, err } from "./result.js";
export type { Result } from "./result.js";

export { CapabilityGate, capabilityMatches, parseCapability } from "./capabilities.js";
export type { ParsedCapability } from "./capabilities.js";

export { HookBus } from "./hooks.js";
export type { Hook } from "./hooks.js";

export { createLogger, redactDeep, SENSITIVE_KEYS } from "./logger.js";
export type { Logger, LoggerOptions } from "./logger.js";

export { loadConfig } from "./config.js";
export type { AppEnv, ConfigStore, PresshConfig } from "./config.js";

export { createFileSystemStorage } from "./storage/fs-adapter.js";
export type { FileSystemStorageOptions } from "./storage/fs-adapter.js";
export { runMigrations } from "./storage/migrations.js";
export type { Cursor, Filter, Page, StorageAdapter, StoredDoc } from "./storage/types.js";
export { createStorageFromConfig, migrateStorage } from "./storage/migrate.js";
export type { StorageConfig, StorageFactory } from "./storage/migrate.js";

export { createFileSecretsBackend, deriveMasterKey, MASTER_KEY_BYTES } from "./secrets.js";
export type { SecretsBackend } from "./secrets.js";

export { createFileAuditLog } from "./audit.js";
export type { AuditEntry, AuditEntryInput, AuditLog, AuditQuery } from "./audit.js";

export { hashPassword, verifyPassword } from "./auth/password.js";
export {
  ROLE_CAPABILITIES,
  ROLE_NAMES,
  capabilitiesForRoles,
  isRoleName,
} from "./auth/roles.js";
export type { RoleName } from "./auth/roles.js";
export { createCsrf } from "./auth/csrf.js";
export type { CsrfProtection } from "./auth/csrf.js";
export { createRateLimiter } from "./auth/rate-limit.js";
export type { RateLimiter, RateLimiterOptions } from "./auth/rate-limit.js";
export { createAuthService } from "./auth/service.js";
export type { AuthService, AuthServiceOptions, Invite, LoginResult, User } from "./auth/service.js";

export { createMetrics, requestId } from "./observability.js";
export type { Labels, Metrics } from "./observability.js";
export { createBackup, restoreBackup } from "./ops/backup.js";
export type { BackupTargets } from "./ops/backup.js";

export { createScheduler } from "./scheduler.js";
export type {
  JobHandler,
  JobRecord,
  JobStatus,
  ScheduleInput,
  Scheduler,
  SchedulerOptions,
} from "./scheduler.js";
