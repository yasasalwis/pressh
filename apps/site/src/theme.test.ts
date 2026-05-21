import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  capabilitiesForRoles,
  createFileAuditLog,
  createFileSystemStorage,
} from "@pressh/core";
import type { StorageAdapter } from "@pressh/core";
import {
  createContentService,
  createQueryResolver,
  createThemeService,
} from "@pressh/engine";
import type { SitePluginHost } from "./app";
import { createSiteApp } from "./app";
import { createRenderCache } from "./cache";

const ADMIN = capabilitiesForRoles(["admin"]);
const EDITOR = capabilitiesForRoles(["editor"]);

const noPlugins: SitePluginHost = { has: () => false, endpoints: () => [], invoke: async () => null };

let dir: string;
let storage: StorageAdapter;

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("site theming", () => {
  it("renders published content through the active theme layout with its tokens", async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-site-theme-"));
    storage = createFileSystemStorage({ root: join(dir, "content") });
    const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
    const content = createContentService({ storage, audit });
    const resolver = createQueryResolver({ content });
    const themeService = createThemeService({ storage, audit });

    const type = await content.createType(ADMIN, {
      name: "Page",
      slug: "page",
      fields: [{ id: "1", name: "title", type: "text", required: true }],
    });
    const entry = await content.createEntry(EDITOR, {
      typeId: type.id,
      slug: "home",
      authorId: "u1",
      fields: { title: "Home" },
      blocks: [{ type: "paragraph", content: "welcome" }],
    });
    await content.transition(EDITOR, entry.id, "published");
    await themeService.setSettings(ADMIN, { tokens: { colorPrimary: "#abcdef" }, siteName: "My Site" });

    const app = createSiteApp({
      resolver,
      pluginHost: noPlugins,
      cache: createRenderCache(),
      themeService,
    });

    const body = await (await app.request("/home")).text();
    expect(body).toContain("--colorPrimary:#abcdef;");
    expect(body).toContain("My Site");
    expect(body).toContain("Powered by Pressh");
    expect(body).toContain("welcome");
  });
});
