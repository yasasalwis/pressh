import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFileAuditLog, createFileSystemStorage } from "@pressh/core";
import type { AuditLog, StorageAdapter } from "@pressh/core";
import { PluginHost, createCveService } from "@pressh/runtime";
import type { CveEntry } from "@pressh/runtime";

const WORKER = fileURLToPath(new URL("../dist/worker-entry.js", import.meta.url));

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-cve-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
});
afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("CveService", () => {
  it("syncs the feed and flags matching plugins", async () => {
    const entries: CveEntry[] = [
      { name: "evil", version: "*", advisory: "CVE-2026-0001" },
      { name: "old", version: "1.0.0", advisory: "CVE-2026-0002" },
    ];
    const cve = createCveService({ storage, audit, source: { fetch: async () => entries } });
    const result = await cve.sync();
    expect(result).toEqual({ synced: 2, stale: false });

    expect(await cve.isFlagged("evil", "9.9.9")).toBe(true); // wildcard
    expect(await cve.isFlagged("old", "1.0.0")).toBe(true);
    expect(await cve.isFlagged("old", "2.0.0")).toBe(false); // different version
    expect(await cve.isFlagged("safe", "1.0.0")).toBe(false);
  });

  it("degrades gracefully and keeps last-known data when the feed fails", async () => {
    let mode: "ok" | "fail" = "ok";
    const cve = createCveService({
      storage,
      audit,
      source: {
        fetch: async () => {
          if (mode === "fail") throw new Error("network down");
          return [{ name: "evil", version: "*", advisory: "x" }];
        },
      },
    });
    await cve.sync();
    expect(await cve.isFlagged("evil", "1.0.0")).toBe(true);

    mode = "fail";
    const result = await cve.sync();
    expect(result.stale).toBe(true);
    // Last-known data is retained.
    expect(await cve.isFlagged("evil", "1.0.0")).toBe(true);
  });
});

describe("PluginHost CVE gate", () => {
  async function writePlugin(name: string): Promise<string> {
    const pluginDir = join(dir, name);
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, "index.mjs"), "export async function noop(){return 1;}", "utf8");
    await writeFile(
      join(pluginDir, "pressh.plugin.json"),
      JSON.stringify({ name, version: "1.0.0", main: "index.mjs", capabilities: [] }),
      "utf8",
    );
    return pluginDir;
  }

  it("refuses to load a flagged plugin and loads a safe one", async () => {
    const checker = { isFlagged: async (name: string) => name === "vuln" };
    const host = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER, cve: checker });

    await expect(host.load(await writePlugin("vuln"))).rejects.toMatchObject({ code: "forbidden" });

    await expect(host.load(await writePlugin("safe"))).resolves.toBeDefined();
    await host.stopAll();
  });
});
