import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capabilitiesForRoles,
  createFileAuditLog,
  createFileSystemStorage,
} from "@pressh/core";
import type { StorageAdapter } from "@pressh/core";
import { createContentService, createQueryResolver } from "@pressh/engine";
import { createSiteApp } from "./app";
import type { SitePluginHost } from "./app";
import { createRenderCache } from "./cache";

const ADMIN = capabilitiesForRoles(["admin"]);
const EDITOR = capabilitiesForRoles(["editor"]);

const stubHost: SitePluginHost = {
  has: () => false,
  endpoints: () => [],
  invoke: async () => ({}),
};

let dir: string;
let storage: StorageAdapter;

async function makeApp(maintenance: boolean): Promise<ReturnType<typeof createSiteApp>> {
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  const content = createContentService({ storage, audit });
  const resolver = createQueryResolver({ content });

  const type = await content.createType(ADMIN, {
    name: "Page",
    slug: "page",
    fields: [{ id: "1", name: "title", type: "text", required: true }],
  });
  const about = await content.createEntry(EDITOR, {
    typeId: type.id,
    slug: "about",
    authorId: "u1",
    fields: { title: "About Us" },
    blocks: [{ type: "paragraph", content: "the about page" }],
  });
  await content.transition(EDITOR, about.id, "published");

  if (maintenance) {
    await storage.put("settings", { id: "general", maintenanceMode: true });
  }

  return createSiteApp({
    resolver,
    pluginHost: stubHost,
    cache: createRenderCache(),
    storage,
    listPublishedPaths: async () => ["/about"],
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-maint-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
});
afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("maintenance mode", () => {
  it("serves the page normally when maintenance is off", async () => {
    const app = await makeApp(false);
    const res = await app.request("/about");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("the about page");
  });

  it("returns 503 with a Retry-After header for public routes when on", async () => {
    const app = await makeApp(true);
    const res = await app.request("/about");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("120");
    expect((await res.text()).toLowerCase()).toContain("maintenance");
  });

  it("blocks public writes (plugin/consent endpoints) during maintenance", async () => {
    const app = await makeApp(true);
    const res = await app.request("/api/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectRef: "s1", scope: "analytics", granted: true }),
    });
    expect(res.status).toBe(503);
  });

  it("keeps the health endpoint reachable during maintenance", async () => {
    const app = await makeApp(true);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });
});
