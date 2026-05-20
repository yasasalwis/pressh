/**
 * Minimal Phase-1 config loader. Reads from an env-like source (defaults to
 * `process.env`) with explicit overrides (the eventual `pressh.config.ts` merge
 * point). Grows in later phases; kept deliberately small and validated here.
 */
export type AppEnv = "development" | "production" | "test";

export interface PresshConfig {
  env: AppEnv;
  /** Production refuses unsigned plugins unless explicitly allowed (ADR-011). */
  allowUnsignedPlugins: boolean;
}

export interface ConfigStore {
  get<K extends keyof PresshConfig>(key: K): PresshConfig[K];
  all(): Readonly<PresshConfig>;
}

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
  overrides: Partial<PresshConfig> = {},
): ConfigStore {
  const rawEnv = source["NODE_ENV"];
  const env: AppEnv = rawEnv === "production" || rawEnv === "test" ? rawEnv : "development";

  const allowUnsignedPlugins =
    overrides.allowUnsignedPlugins ?? (env !== "production" || source["PRESSH_ALLOW_UNSIGNED"] === "1");

  const config: PresshConfig = {
    env: overrides.env ?? env,
    allowUnsignedPlugins,
  };

  return {
    get: (key) => config[key],
    all: () => Object.freeze({ ...config }),
  };
}
