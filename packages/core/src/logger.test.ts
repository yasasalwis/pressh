import { describe, it, expect } from "vitest";
import { pino } from "pino";
import { createLogger, redactDeep } from "@pressh/core";

describe("redactDeep", () => {
  it("redacts top-level sensitive keys", () => {
    expect(redactDeep({ password: "hunter2", user: "bob" })).toEqual({
      password: "[REDACTED]",
      user: "bob",
    });
  });
  it("redacts nested keys", () => {
    expect(redactDeep({ a: { token: "xyz", keep: 1 } })).toEqual({
      a: { token: "[REDACTED]", keep: 1 },
    });
  });
  it("redacts inside arrays", () => {
    expect(redactDeep([{ secret: "s" }, { ok: true }])).toEqual([
      { secret: "[REDACTED]" },
      { ok: true },
    ]);
  });
  it("matches keys case-insensitively", () => {
    expect(redactDeep({ Password: "x", AUTHORIZATION: "Bearer y" })).toEqual({
      Password: "[REDACTED]",
      AUTHORIZATION: "[REDACTED]",
    });
  });
  it("leaves primitives untouched", () => {
    expect(redactDeep("plain")).toBe("plain");
    expect(redactDeep(42)).toBe(42);
  });
  it("is cycle-safe", () => {
    const a: Record<string, unknown> = { name: "x" };
    a["self"] = a;
    expect(() => redactDeep(a)).not.toThrow();
  });
});

describe("createLogger", () => {
  it("redacts sensitive fields in emitted log lines", () => {
    const lines: string[] = [];
    const stream = { write: (s: string) => void lines.push(s) };
    const instance = pino({ level: "info" }, stream as unknown as Parameters<typeof pino>[1]);
    const log = createLogger({ pino: instance });

    log.info("login", { password: "secret123", email: "bob@example.com" });

    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record["password"]).toBe("[REDACTED]");
    expect(record["email"]).toBe("bob@example.com");
    expect(record["msg"]).toBe("login");
  });

  it("supports child loggers", () => {
    const log = createLogger();
    expect(() => log.child({ requestId: "r1" }).info("ok")).not.toThrow();
  });
});
