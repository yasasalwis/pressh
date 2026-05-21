import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileAuditLog, createFileSystemStorage } from "@pressh/core";
import type { StorageAdapter } from "@pressh/core";
import { createContentService, createQueryResolver } from "@pressh/engine";
import { createSiteApp } from "./app";
import type { SitePluginHost } from "./app";
import { createRenderCache } from "./cache";

const noPlugins: SitePluginHost = { has: () => false, endpoints: () => [], invoke: async () => null };

let dir: string;
let storage: StorageAdapter;

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

async function makeApp(): Promise<ReturnType<typeof createSiteApp>> {
  dir = await mkdtemp(join(tmpdir(), "pressh-ops-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  const content = createContentService({ storage, audit });
  return createSiteApp({
    resolver: createQueryResolver({ content }),
    pluginHost: noPlugins,
    cache: createRenderCache(),
    storage,
  });
}

describe("site ops endpoints", () => {
  it("serves healthz, readyz, and a request id", async () => {
    const app = await makeApp();
    const health = await app.request("/healthz");
    expect(health.status).toBe(200);
    expect((await health.json()) as { status: string }).toEqual({ status: "ok" });
    expect(health.headers.get("x-request-id")).toBeTruthy();

    const ready = await app.request("/readyz");
    expect(ready.status).toBe(200);
  });

  it("exposes Prometheus metrics that count requests", async () => {
    const app = await makeApp();
    await app.request("/healthz");
    const res = await app.request("/metrics");
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("pressh_http_requests_total");
    expect(body).toContain("# TYPE pressh_http_requests_total counter");
  });

  it("propagates a provided x-request-id", async () => {
    const app = await makeApp();
    const res = await app.request("/healthz", { headers: { "x-request-id": "trace-123" } });
    expect(res.headers.get("x-request-id")).toBe("trace-123");
  });
});
