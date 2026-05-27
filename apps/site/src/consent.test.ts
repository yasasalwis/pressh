import {afterEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {StorageAdapter} from "@pressh/core";
import {createFileAuditLog, createFileSystemStorage} from "@pressh/core";
import {createContentService, createGdprService, createQueryResolver} from "@pressh/engine";
import type {SitePluginHost} from "./app";
import {createSiteApp} from "./app";
import {createRenderCache} from "./cache";

const noPlugins: SitePluginHost = { has: () => false, endpoints: () => [], invoke: async () => null };

let dir: string;
let storage: StorageAdapter;

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("public consent endpoint", () => {
  it("records consent and rejects malformed bodies", async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-consent-"));
    storage = createFileSystemStorage({ root: join(dir, "content") });
    const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
    const content = createContentService({ storage, audit });
    const gdpr = createGdprService({ storage, audit, scopes: [] });
    const app = createSiteApp({
      resolver: createQueryResolver({ content }),
      pluginHost: noPlugins,
      cache: createRenderCache(),
      gdpr,
    });

    const ok = await app.request("/api/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectRef: "visitor-1", scope: "analytics", granted: true }),
    });
    expect(ok.status).toBe(200);
      expect(await gdpr.getConsent(["gdpr.manage"], "visitor-1", "analytics")).toBe(true);

    const bad = await app.request("/api/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ granted: true }),
    });
    expect(bad.status).toBe(400);
  });
});
