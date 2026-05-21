import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createFileAuditLog, createFileSystemStorage } from "@pressh/core";
import type { AuditLog, StorageAdapter } from "@pressh/core";
import { PluginHost } from "@pressh/runtime";

// The worker must be the COMPILED script (worker_threads cannot run TS source).
// `npm run build:packages` runs before `npm test` in the acceptance gate.
const WORKER = fileURLToPath(new URL("../dist/worker-entry.js", import.meta.url));

const PLUGIN_SRC = `
export async function greet(args, host) {
  host.log("info", "greet called");
  return String(args.name).toUpperCase();
}
export async function readColl(args, host) {
  try {
    const doc = await host.storage.get(args.collection, args.id);
    return { ok: true, doc };
  } catch (e) {
    return { ok: false, code: e.code ?? e.message };
  }
}
export async function hang() {
  while (true) { /* busy loop */ }
}
export async function readEnv() {
  return process.env.PRESSH_TEST_SECRET ?? "none";
}
`;

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;

async function writePlugin(
  name: string,
  capabilities: string[],
  opts: { signed?: boolean; endpoints?: unknown[] } = {},
): Promise<string> {
  const pluginDir = join(dir, name);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, "index.mjs"), PLUGIN_SRC, "utf8");
  const manifest: Record<string, unknown> = { name, version: "0.0.0", main: "index.mjs", capabilities };
  if (opts.endpoints) manifest["endpoints"] = opts.endpoints;
  await writeFile(join(pluginDir, "pressh.plugin.json"), JSON.stringify(manifest), "utf8");
  if (opts.signed) {
    const content = await readFile(join(pluginDir, "index.mjs"));
    const hash = createHash("sha256").update(content).digest("hex");
    await writeFile(
      join(pluginDir, "pressh.signature.json"),
      JSON.stringify({ algorithm: "sha256", hash }),
      "utf8",
    );
  }
  return pluginDir;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-host-"));
  storage = createFileSystemStorage({ root: join(dir, "_content") });
  audit = await createFileAuditLog({ path: join(dir, "audit.log") });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("PluginHost", () => {
  it("loads a plugin in a real worker and invokes a method over RPC", async () => {
    const host = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER });
    const pluginDir = await writePlugin("greeter", []);
    await host.load(pluginDir);
    expect(host.has("greeter")).toBe(true);
    expect(await host.invoke("greeter", "greet", { name: "bob" })).toBe("BOB");
    await host.stopAll();
  });

  it("allows a granted capability and denies (and audits) an ungranted one", async () => {
    const host = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER });
    const id = randomUUID();
    await storage.put("posts", { id, title: "Hello" });
    const pluginDir = await writePlugin("reader", ["storage.read:posts"]);
    await host.load(pluginDir);

    const allowed = (await host.invoke("reader", "readColl", { collection: "posts", id })) as {
      ok: boolean;
      doc: { title: string };
    };
    expect(allowed.ok).toBe(true);
    expect(allowed.doc.title).toBe("Hello");

    const denied = (await host.invoke("reader", "readColl", {
      collection: "secret",
      id,
    })) as { ok: boolean; code: string };
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe("capability_denied");

    const audited = await audit.query({ action: "plugin.capability_denied" });
    expect(audited.length).toBeGreaterThanOrEqual(1);
    await host.stopAll();
  });

  it("cannot read host environment variables", async () => {
    process.env["PRESSH_TEST_SECRET"] = "leaky";
    const host = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER });
    const pluginDir = await writePlugin("env", []);
    await host.load(pluginDir);
    expect(await host.invoke("env", "readEnv", {})).toBe("none");
    await host.stopAll();
    delete process.env["PRESSH_TEST_SECRET"];
  });

  it("rejects an unsigned plugin in production mode", async () => {
    const host = new PluginHost({ storage, audit, allowUnsigned: false, workerScript: WORKER });
    const pluginDir = await writePlugin("unsigned", []);
    await expect(host.load(pluginDir)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("loads a correctly signed plugin and rejects a tampered one", async () => {
    const signedHost = new PluginHost({ storage, audit, allowUnsigned: false, workerScript: WORKER });
    const pluginDir = await writePlugin("signed", [], { signed: true });
    await expect(signedHost.load(pluginDir)).resolves.toBeDefined();
    await signedHost.stopAll();

    // Tamper the main file after signing.
    await writeFile(join(pluginDir, "index.mjs"), `${PLUGIN_SRC}\n// tampered`, "utf8");
    const tamperHost = new PluginHost({ storage, audit, allowUnsigned: false, workerScript: WORKER });
    await expect(tamperHost.load(pluginDir)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("kills a hung worker on timeout and respawns for the next call", async () => {
    const host = new PluginHost({
      storage,
      audit,
      allowUnsigned: true,
      workerScript: WORKER,
      invokeTimeoutMs: 300,
    });
    const pluginDir = await writePlugin("hangs", []);
    await host.load(pluginDir);

    await expect(host.invoke("hangs", "hang", {})).rejects.toMatchObject({ code: "internal" });
    // The worker was killed and respawned — a normal call now succeeds.
    expect(await host.invoke("hangs", "greet", { name: "ok" })).toBe("OK");
    await host.stopAll();
  });

  it("aggregates the endpoint manifest", async () => {
    const host = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER });
    const pluginDir = await writePlugin("api", [], {
      endpoints: [{ method: "POST", path: "/do", handler: "greet" }],
    });
    await host.load(pluginDir);
    expect(host.endpoints()).toEqual([
      { plugin: "api", method: "POST", path: "/do", handler: "greet" },
    ]);
    await host.stopAll();
  });
});
