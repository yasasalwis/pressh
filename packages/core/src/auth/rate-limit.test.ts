import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@pressh/core";

describe("rate limiter", () => {
  it("allows up to the limit then blocks", () => {
    const t = 1000;
    const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect(rl.check("ip")).toBe(true);
    expect(rl.check("ip")).toBe(true);
    expect(rl.check("ip")).toBe(true);
    expect(rl.check("ip")).toBe(false);
  });

  it("resets after the window elapses", () => {
    let t = 1000;
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(rl.check("ip")).toBe(true);
    expect(rl.check("ip")).toBe(false);
    t += 1001;
    expect(rl.check("ip")).toBe(true);
  });

  it("tracks keys independently and supports reset", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 10_000 });
    expect(rl.check("a")).toBe(true);
    expect(rl.check("b")).toBe(true);
    expect(rl.check("a")).toBe(false);
    rl.reset("a");
    expect(rl.check("a")).toBe(true);
  });
});
