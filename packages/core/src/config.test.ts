import { describe, it, expect } from "vitest";
import { loadConfig } from "@pressh/core";

describe("loadConfig", () => {
  it("defaults to development when NODE_ENV is unset", () => {
    const cfg = loadConfig({});
    expect(cfg.get("env")).toBe("development");
  });

  it("reads production from NODE_ENV", () => {
    const cfg = loadConfig({ NODE_ENV: "production" });
    expect(cfg.get("env")).toBe("production");
  });

  it("allows unsigned plugins in development", () => {
    expect(loadConfig({ NODE_ENV: "development" }).get("allowUnsignedPlugins")).toBe(true);
  });

  it("refuses unsigned plugins in production by default", () => {
    expect(loadConfig({ NODE_ENV: "production" }).get("allowUnsignedPlugins")).toBe(false);
  });

  it("allows unsigned in production only with the explicit override flag", () => {
    const cfg = loadConfig({ NODE_ENV: "production", PRESSH_ALLOW_UNSIGNED: "1" });
    expect(cfg.get("allowUnsignedPlugins")).toBe(true);
  });

  it("explicit overrides win", () => {
    const cfg = loadConfig({ NODE_ENV: "production" }, { allowUnsignedPlugins: true });
    expect(cfg.get("allowUnsignedPlugins")).toBe(true);
  });

  it("all() returns a frozen snapshot", () => {
    const all = loadConfig({ NODE_ENV: "test" }).all();
    expect(all.env).toBe("test");
    expect(Object.isFrozen(all)).toBe(true);
  });
});
