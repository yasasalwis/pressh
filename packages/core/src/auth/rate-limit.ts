/**
 * Simple in-memory fixed-window rate limiter (baseline #12) for the HTTP layer
 * to throttle auth and other sensitive endpoints by key (e.g. IP). Per-account
 * lockout is handled separately inside the AuthService.
 */
export interface RateLimiter {
  /** Returns true if the request is allowed; false if the window is exhausted. */
  check(key: string): boolean;
  reset(key: string): void;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? (() => Date.now());

  return {
    check(key) {
      const t = now();
      const current = hits.get(key);
      if (!current || current.resetAt <= t) {
        hits.set(key, { count: 1, resetAt: t + opts.windowMs });
        return true;
      }
      if (current.count >= opts.limit) return false;
      current.count += 1;
      return true;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
