import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  CapabilityGate,
  capabilitiesForRoles,
  createAuthService,
  createCsrf,
  createFileAuditLog,
  createFileSecretsBackend,
  createFileSystemStorage,
  redactDeep,
} from "@pressh/core";
import type { AuditLog, StorageAdapter } from "@pressh/core";
import {
  createBlockRegistry,
  createContentService,
  createQueryResolver,
  sanitizeBlocks,
} from "@pressh/engine";
import { createCveService } from "@pressh/runtime";
import { validateUpload } from "@pressh/studio";
import { createRenderCache, createSiteApp } from "@pressh/site";
import type { SitePluginHost } from "@pressh/site";

const ADMIN = capabilitiesForRoles(["admin"]);
const EDITOR = capabilitiesForRoles(["editor"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noPlugins: SitePluginHost = { has: () => false, endpoints: () => [], invoke: async () => null };

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-baselines-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
});
afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("14 secure-by-default baselines", () => {
  it("#1 content IDs are UUIDs (no IDOR)", async () => {
    const content = createContentService({ storage, audit });
    const type = await content.createType(ADMIN, {
      name: "P",
      slug: "p",
      fields: [{ id: "1", name: "title", type: "text", required: true }],
    });
    const entry = await content.createEntry(EDITOR, {
      typeId: type.id,
      slug: "x",
      authorId: "u1",
      fields: { title: "T" },
    });
    expect(entry.id).toMatch(UUID);
  });

  it("#2 public scope returns published-only", async () => {
    const content = createContentService({ storage, audit });
    const resolver = createQueryResolver({ content });
    const type = await content.createType(ADMIN, {
      name: "P",
      slug: "p",
      fields: [{ id: "1", name: "title", type: "text", required: true }],
    });
    await content.createEntry(EDITOR, { typeId: type.id, slug: "draft", authorId: "u1", fields: { title: "T" } });
    await expect(resolver.resolve({ slug: "draft", scope: "public" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("#3 no user enumeration (uniform auth errors)", async () => {
    const auth = await createAuthService({ storage, audit });
    await auth.createUser({ email: "a@b.com", password: "supersecret", roles: ["author"] });
    await expect(auth.authenticate({ email: "a@b.com", password: "wrong" })).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(auth.authenticate({ email: "ghost@b.com", password: "wrong" })).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("#4 blocks are sanitized; raw HTML is capability-gated", () => {
    const registry = createBlockRegistry();
    const out = sanitizeBlocks(registry, [{ type: "paragraph", content: "x<script>y</script>" }], {
      capabilities: [],
    });
    expect(out[0]?.content).toBe("x");
    expect(() => sanitizeBlocks(registry, [{ type: "html", content: "<p>x</p>" }], { capabilities: [] })).toThrow();
  });

  it("#5 CSRF tokens are bound and verified centrally", () => {
    const csrf = createCsrf(randomBytes(32));
    const token = csrf.issue("session-1");
    expect(csrf.verify("session-1", token)).toBe(true);
    expect(csrf.verify("session-1", `${token}x`)).toBe(false);
  });

  it("#6 sensitive fields are redacted in logs/audit", () => {
    expect(redactDeep({ password: "x", ok: 1 })).toEqual({ password: "[REDACTED]", ok: 1 });
  });

  it("#7 secrets vault is sealed (fail-closed on wrong key)", async () => {
    const path = join(dir, "vault.json");
    await (await createFileSecretsBackend({ path, key: randomBytes(32) })).setSecret("k", "v");
    const wrong = await createFileSecretsBackend({ path, key: randomBytes(32) });
    await expect(wrong.getSecret("k")).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("#8 audit log is append-only and verifiable", async () => {
    await audit.append({ action: "a", actorId: "u1" });
    await audit.append({ action: "b", actorId: "u1" });
    expect(await audit.verifyChain()).toBe(true);
  });

  it("#9 TLS is enforced in production (HSTS)", async () => {
    const content = createContentService({ storage, audit });
    const app = createSiteApp({
      resolver: createQueryResolver({ content }),
      pluginHost: noPlugins,
      cache: createRenderCache(),
      production: true,
    });
    const res = await app.request("/");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("#10 strict CSP is set on public responses", async () => {
    const content = createContentService({ storage, audit });
    const app = createSiteApp({
      resolver: createQueryResolver({ content }),
      pluginHost: noPlugins,
      cache: createRenderCache(),
    });
    const res = await app.request("/");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("#11 the CVE feed flags known-vulnerable plugins", async () => {
    const cve = createCveService({
      storage,
      audit,
      source: { fetch: async () => [{ name: "evil", version: "*", advisory: "x" }] },
    });
    await cve.sync();
    expect(await cve.isFlagged("evil", "1.0.0")).toBe(true);
    expect(await cve.isFlagged("safe", "1.0.0")).toBe(false);
  });

  it("#12 auth rate-limits and locks out", async () => {
    const auth = await createAuthService({ storage, audit, maxFailedAttempts: 2 });
    await auth.createUser({ email: "a@b.com", password: "supersecret", roles: ["author"] });
    await expect(auth.authenticate({ email: "a@b.com", password: "x" })).rejects.toBeDefined();
    await expect(auth.authenticate({ email: "a@b.com", password: "x" })).rejects.toBeDefined();
      // The account is now locked: even the correct password is refused — with the
      // SAME generic error as a bad password, so a locked (existing) account is
      // indistinguishable from a wrong guess (no user enumeration).
    await expect(auth.authenticate({ email: "a@b.com", password: "supersecret" })).rejects.toMatchObject({
        code: "unauthorized",
    });
      // The lockout itself is recorded for operators in the audit log.
      expect((await audit.query({action: "user.account.locked"})).length).toBeGreaterThanOrEqual(1);
  });

  it("#13 uploads are validated (disguised files rejected)", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const script = new TextEncoder().encode("#!/bin/sh");
    expect(validateUpload("logo.png", "image/png", png)).toEqual({ ext: "png", mime: "image/png" });
    expect(() => validateUpload("evil.png", "image/png", script)).toThrow();
  });

  it("#14 plugins have no raw DB access by default", () => {
    const gate = new CapabilityGate();
    expect(gate.check([], "storage.raw")).toBe(false);
    expect(gate.check(["storage.read:posts"], "storage.raw")).toBe(false);
    expect(gate.check(["storage.raw"], "storage.raw")).toBe(true);
  });
});
