import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capabilitiesForRoles,
  createFileAuditLog,
  createFileSystemStorage,
} from "@pressh/core";
import type { AuditLog, StorageAdapter } from "@pressh/core";
import {
  createThemeService,
  defaultTheme,
  renderCssVars,
  resolveTokens,
  validateTokens,
} from "@pressh/engine";
import type { ThemeService } from "@pressh/engine";

const ADMIN = capabilitiesForRoles(["admin"]); // has themes.manage
const AUTHOR = capabilitiesForRoles(["author"]); // does not

describe("token validation", () => {
  it("accepts valid token values", () => {
    expect(() =>
      validateTokens(defaultTheme, { colorPrimary: "#abc123", maxWidth: "800px", fontBody: "Inter, sans-serif" }),
    ).not.toThrow();
  });
  it("rejects an unknown token", () => {
    expect(() => validateTokens(defaultTheme, { evil: "x" })).toThrowError(/Unknown theme token/);
  });
  it("rejects a CSS-injection attempt in a color", () => {
    expect(() => validateTokens(defaultTheme, { colorPrimary: "#fff;}body{display:none" })).toThrow();
  });
  it("rejects a malformed size", () => {
    expect(() => validateTokens(defaultTheme, { maxWidth: "800" })).toThrow();
  });
});

describe("css var rendering", () => {
  it("emits resolved variables", () => {
    const css = renderCssVars(defaultTheme, resolveTokens(defaultTheme, { colorPrimary: "#123456" }));
    expect(css).toContain("--colorPrimary:#123456;");
    expect(css).toContain("--colorBackground:#ffffff;");
  });
});

describe("ThemeService", () => {
  let dir: string;
  let storage: StorageAdapter;
  let audit: AuditLog;
  let svc: ThemeService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-theme-"));
    storage = createFileSystemStorage({ root: join(dir, "content") });
    audit = await createFileAuditLog({ path: join(dir, "audit.log") });
    svc = createThemeService({ storage, audit });
  });
  afterEach(async () => {
    storage.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("returns default settings before any are saved", async () => {
    const settings = await svc.getSettings();
    expect(settings.theme).toBe("default");
  });

  it("requires themes.manage to change settings", async () => {
    await expect(svc.setSettings(AUTHOR, { tokens: { colorPrimary: "#000000" } })).rejects.toMatchObject({
      code: "capability_denied",
    });
  });

  it("persists settings and reflects them in resolve()", async () => {
    await svc.setSettings(ADMIN, { tokens: { colorPrimary: "#ff0000" }, siteName: "Acme" });
    const resolved = await svc.resolve();
    expect(resolved.tokens["colorPrimary"]).toBe("#ff0000");
    expect(resolved.siteName).toBe("Acme");
    expect(resolved.cssVars).toContain("--colorPrimary:#ff0000;");
  });

  it("rejects an injection attempt at the service boundary", async () => {
    await expect(
      svc.setSettings(ADMIN, { tokens: { colorPrimary: "red;}*{x" } }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("renders an injection-safe preview", () => {
    const html = svc.preview({ tokens: { colorPrimary: "#00ff00" } });
    expect(html).toContain("--colorPrimary:#00ff00;");
    expect(html).toContain("Sample heading");
  });
});
