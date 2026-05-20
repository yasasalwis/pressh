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
