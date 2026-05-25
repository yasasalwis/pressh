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
export async function listColls(args, host) {
  try { return { ok: true, collections: await host.storage.list() }; }
  catch (e) { return { ok: false, code: e.code ?? e.message }; }
}
export async function del(args, host) {
  try { await host.storage.delete(args.collection, args.id); return { ok: true }; }
  catch (e) { return { ok: false, code: e.code ?? e.message }; }
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

describe("PluginHost enable/disable", () => {
  it("registers without spawning a worker; enabling starts it, disabling stops it", async () => {
    const host = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER });
    const pluginDir = await writePlugin("toggle", []);

    await host.register(pluginDir);
    expect(host.isRegistered("toggle")).toBe(true);
    expect(host.has("toggle")).toBe(false); // registered but no worker yet
    // A disabled plugin serves no endpoints and cannot be invoked.
    await expect(host.invoke("toggle", "greet", { name: "x" })).rejects.toMatchObject({
      code: "not_found",
    });

    await host.enable("toggle");
    expect(host.has("toggle")).toBe(true);
    expect(await host.invoke("toggle", "greet", { name: "x" })).toBe("X");

    await host.disable("toggle");
    expect(host.has("toggle")).toBe(false);
    expect(host.isRegistered("toggle")).toBe(true); // still known, just not running
    await host.stopAll();
  });

  it("persists the enabled set through the state store and auto-starts on register", async () => {
    const enabled = new Set<string>();
    const state = {
      isEnabled: async (name: string) => enabled.has(name),
      setEnabled: async (name: string, on: boolean) => void (on ? enabled.add(name) : enabled.delete(name)),
    };
    const pluginDir = await writePlugin("persisted", []);

    const host1 = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER, state });
    await host1.register(pluginDir);
    expect(host1.has("persisted")).toBe(false);
    await host1.enable("persisted");
    expect(enabled.has("persisted")).toBe(true); // wrote through
    await host1.stopAll();

    // A fresh host (e.g. the Site process) sees the persisted state and auto-starts.
    const host2 = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER, state });
    await host2.register(pluginDir);
    expect(host2.has("persisted")).toBe(true);
    await host2.stopAll();
  });

  it("reports enabled + builtin flags via plugins()", async () => {
    const host = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER });
    await host.register(await writePlugin("first", []), { builtin: true });
    await host.enable("first");
    await host.register(await writePlugin("second", []));

    const info = host.plugins();
    const first = info.find((p) => p.name === "first");
    const second = info.find((p) => p.name === "second");
    expect(first).toMatchObject({ enabled: true, builtin: true });
    expect(second).toMatchObject({ enabled: false, builtin: false });
    await host.stopAll();
  });
});

describe("PluginHost storage services", () => {
  it("gates storage.list behind storage.read:* (deny then allow)", async () => {
    await storage.put("posts", { id: randomUUID(), title: "p" });

    const denied = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER });
    await denied.load(await writePlugin("nolist", ["storage.read:posts"]));
    const r1 = (await denied.invoke("nolist", "listColls", {})) as { ok: boolean; code?: string };
    expect(r1.ok).toBe(false);
    expect(r1.code).toBe("capability_denied");
    await denied.stopAll();

    const allowed = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER });
    await allowed.load(await writePlugin("canlist", ["storage.read:*"]));
    const r2 = (await allowed.invoke("canlist", "listColls", {})) as {
      ok: boolean;
      collections: string[];
    };
    expect(r2.ok).toBe(true);
    expect(r2.collections).toContain("posts");
    await allowed.stopAll();
  });

  it("gates storage.delete behind storage.write and refuses reserved collections", async () => {
    const id = randomUUID();
    await storage.put("widgets", { id, name: "w" });

    const host = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER });
    await host.load(await writePlugin("deleter", ["storage.write:widgets"]));

    const ok = (await host.invoke("deleter", "del", { collection: "widgets", id })) as {
      ok: boolean;
    };
    expect(ok.ok).toBe(true);
    expect((await storage.get("widgets", id)).ok && (await storage.get("widgets", id)).value).toBeNull();

    // Reserved collections are off-limits regardless of the granted capability.
    const reserved = (await host.invoke("deleter", "del", {
      collection: "users",
      id: "anything",
    })) as { ok: boolean; code?: string };
    expect(reserved.ok).toBe(false);
    expect(reserved.code).toBe("capability_denied");
    await host.stopAll();
  });
});
