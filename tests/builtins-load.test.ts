import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import type {AuditLog, StorageAdapter} from "@pressh/core";
import {createFileAuditLog, createFileSystemStorage} from "@pressh/core";
import {createPluginStateStore, PluginHost} from "@pressh/runtime";

// Exercises the REAL shipped builtins/ folder through an actual worker thread —
// proving the manifests parse, the .mjs modules load, and the enable/disable
// flow works against the artifacts we ship (not synthetic fixtures).
const WORKER = fileURLToPath(new URL("../packages/runtime/dist/worker-entry.js", import.meta.url));
const BUILTINS = fileURLToPath(new URL("../builtins", import.meta.url));

const EXPECTED = ["analytics", "comments", "db", "forms", "inventory", "seo"];

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-builtins-"));
  storage = createFileSystemStorage({ root: join(dir, "_content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

async function registerAll(host: PluginHost): Promise<void> {
  for (const entry of await readdir(BUILTINS, { withFileTypes: true })) {
    if (entry.isDirectory()) await host.register(join(BUILTINS, entry.name), { builtin: true });
  }
}

describe("shipped built-in plugins", () => {
  it("all register, default to disabled, and report as built-in", async () => {
    const host = new PluginHost({
      storage,
      audit,
      allowUnsigned: true,
      workerScript: WORKER,
      state: createPluginStateStore(storage),
    });
    await registerAll(host);

    const names = host.plugins().map((p) => p.name).sort();
    expect(names).toEqual(EXPECTED);
    for (const p of host.plugins()) {
      expect(p.builtin).toBe(true);
      expect(p.enabled).toBe(false); // lean by default — nothing runs until enabled
    }
    await host.stopAll();
  });

  it("enables a built-in, runs its handler over the worker, then disables it", async () => {
    const host = new PluginHost({
      storage,
      audit,
      allowUnsigned: true,
      workerScript: WORKER,
      state: createPluginStateStore(storage),
    });
    await registerAll(host);

    await host.enable("inventory");
    expect(host.has("inventory")).toBe(true);
    const empty = (await host.invoke("inventory", "publicItems", {})) as { items: unknown[] };
    expect(empty.items).toEqual([]);

    await host.invoke("inventory", "save", {
      item: { name: "Widget", price: 5, stock: 2, published: true },
    });
    const stocked = (await host.invoke("inventory", "publicItems", {})) as {
      items: { name: string }[];
    };
    expect(stocked.items.map((i) => i.name)).toEqual(["Widget"]);

    await host.disable("inventory");
    expect(host.has("inventory")).toBe(false);
    await host.stopAll();
  });

    it("contributes designer presets only while the plugin is enabled", async () => {
        const host = new PluginHost({
            storage,
            audit,
            allowUnsigned: true,
            workerScript: WORKER,
            state: createPluginStateStore(storage),
        });
        await registerAll(host);

        // Disabled by default → no presets surface to the studio palette.
        expect(host.designerPresets()).toEqual([]);

        await host.enable("inventory");
        const contributed = host.designerPresets();
        const inventory = contributed.find((p) => p.plugin === "inventory");
        expect(inventory).toBeTruthy();
        // ids are namespaced to the plugin to avoid clashing with built-ins.
        expect(inventory!.presets.some((p) => p.id === "inventory:product-grid")).toBe(true);

        await host.disable("inventory");
        expect(host.designerPresets()).toEqual([]);
        await host.stopAll();
    });
});
