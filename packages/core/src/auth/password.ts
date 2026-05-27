import argon2 from "argon2";

/**
 * argon2id parameters (SAD §3.3, FR-001). Tuned for small VMs: the library
 * default is 64 MiB + 4 lanes per hash, so a few concurrent logins alone could
 * spike past a 512 MB box. These are OWASP's minimum recommended argon2id
 * settings — 19 MiB, 2 iterations, single lane — which keep the hash strong
 * while bounding per-hash memory to ~19 MiB and avoiding thread fan-out. The
 * cost lives in the encoded hash, so existing hashes still verify after a
 * retune. Override via env for beefier hosts.
 */
const ARGON2_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: envInt("PRESSH_ARGON2_MEMORY_KIB") ?? 19_456, // 19 MiB
    timeCost: envInt("PRESSH_ARGON2_TIME_COST") ?? 2,
    parallelism: envInt("PRESSH_ARGON2_PARALLELISM") ?? 1,
} as const;

function envInt(name: string): number | undefined {
    const raw = process.env[name];
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Password hashing with argon2id (SAD §3.3, FR-001). */
export async function hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
