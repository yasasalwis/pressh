import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import type {AuditLog, StorageAdapter} from "@pressh/core";
import {createFileAuditLog, createFileSystemStorage} from "@pressh/core";
import {PluginHost} from "@pressh/runtime";
import {buildSignature, derivePluginSigningKey} from "./plugin-signature.js";

// The worker must be the COMPILED script (worker_threads cannot run TS source).
// `npm run build:packages` runs before `npm test` in the acceptance gate.
const WORKER = fileURLToPath(new URL("../dist/worker-entry.js", import.meta.url));

// A known signing secret for tests; the host derives the same HMAC key from it.
const SIGNING_SECRET = "test-master-key-0123456789";

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
export async function attemptEscapes() {
  const tryImport = async (m) => { try { await import(m); return "loaded"; } catch (e) { return "denied"; } };
  return {
    childProcess: await tryImport("node:child_process"),
    fs: await tryImport("node:fs"),
    fsPromises: await tryImport("node:fs/promises"),
    net: await tryImport("node:net"),
    http: await tryImport("node:http"),
    https: await tryImport("node:https"),
    dns: await tryImport("node:dns"),
    os: await tryImport("node:os"),
    vm: await tryImport("node:vm"),
    workerThreads: await tryImport("node:worker_threads"),
    nodeModule: await tryImport("node:module"),
    process: await tryImport("node:process"),
    npmDep: await tryImport("vitest"),
    fetch: typeof fetch,
    webSocket: typeof WebSocket,
    procBinding: typeof process.binding,
    // Allowlisted pure-computation builtins must still work:
    crypto: await tryImport("node:crypto"),
    util: await tryImport("node:util"),
  };
}
export async function attemptFsWrite() {
  // Even if fs could be reached, the permission model denies writes. Reach it
  // via the not-yet-scrubbed require if available; otherwise report the import.
  try {
    const fs = await import("node:fs");
    fs.writeFileSync("/tmp/pressh-escape-probe.txt", "x");
    return "WROTE";
  } catch (e) {
    return "blocked:" + (e.code || "import-denied");
  }
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
  opts: { signed?: boolean; endpoints?: unknown[]; presets?: unknown[] } = {},
): Promise<string> {
  const pluginDir = join(dir, name);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, "index.mjs"), PLUGIN_SRC, "utf8");
  const manifest: Record<string, unknown> = { name, version: "0.0.0", main: "index.mjs", capabilities };
  if (opts.endpoints) manifest["endpoints"] = opts.endpoints;
    if (opts.presets) {
        manifest["designerPresets"] = "presets.json";
        await writeFile(join(pluginDir, "presets.json"), JSON.stringify(opts.presets), "utf8");
    }
  await writeFile(join(pluginDir, "pressh.plugin.json"), JSON.stringify(manifest), "utf8");
  if (opts.signed) {
      // Sign with the same secret the verifying host derives its key from.
      const signature = await buildSignature(pluginDir, derivePluginSigningKey(SIGNING_SECRET));
      await writeFile(join(pluginDir, "pressh.signature.json"), JSON.stringify(signature), "utf8");
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

    it("sandboxes the worker: denies I/O builtins, npm deps, fetch — allows pure-computation builtins", async () => {
        const host = new PluginHost({storage, audit, allowUnsigned: true, workerScript: WORKER});
        const pluginDir = await writePlugin("escaper", []);
        await host.load(pluginDir);
        const r = (await host.invoke("escaper", "attemptEscapes", {})) as Record<string, string>;

        // I/O-capable builtins are denied (network the permission model misses,
        // plus fs/process/etc. as defense-in-depth).
        for (const mod of [
            "childProcess", "fs", "fsPromises", "net", "http", "https",
            "dns", "os", "vm", "workerThreads", "nodeModule", "process",
        ]) {
            expect(r[mod], `${mod} must be denied`).toBe("denied");
        }
        // Bare npm specifiers are denied (plugins bundle their deps).
        expect(r["npmDep"]).toBe("denied");
        // Network-egress globals are scrubbed.
        expect(r["fetch"]).toBe("undefined");
        expect(r["webSocket"]).toBe("undefined");
        expect(r["procBinding"]).toBe("undefined");
        // Pure-computation builtins remain available so plugins can still work.
        expect(r["crypto"]).toBe("loaded");
        expect(r["util"]).toBe("loaded");

        await host.stopAll();
    });

    it("denies filesystem writes from inside a plugin worker", async () => {
        const host = new PluginHost({storage, audit, allowUnsigned: true, workerScript: WORKER});
        const pluginDir = await writePlugin("writer", []);
        await host.load(pluginDir);
        const result = (await host.invoke("writer", "attemptFsWrite", {})) as string;
        expect(result.startsWith("blocked")).toBe(true);
        await host.stopAll();
    });

  it("rejects an unsigned plugin in production mode", async () => {
    const host = new PluginHost({ storage, audit, allowUnsigned: false, workerScript: WORKER });
    const pluginDir = await writePlugin("unsigned", []);
    await expect(host.load(pluginDir)).rejects.toMatchObject({ code: "forbidden" });
  });

    it("loads a correctly signed plugin and rejects a tampered main file", async () => {
        const signedHost = new PluginHost({
            storage,
            audit,
            allowUnsigned: false,
            signingSecret: SIGNING_SECRET,
            workerScript: WORKER
        });
    const pluginDir = await writePlugin("signed", [], { signed: true });
    await expect(signedHost.load(pluginDir)).resolves.toBeDefined();
    await signedHost.stopAll();

    // Tamper the main file after signing.
    await writeFile(join(pluginDir, "index.mjs"), `${PLUGIN_SRC}\n// tampered`, "utf8");
        const tamperHost = new PluginHost({
            storage,
            audit,
            allowUnsigned: false,
            signingSecret: SIGNING_SECRET,
            workerScript: WORKER
        });
    await expect(tamperHost.load(pluginDir)).rejects.toMatchObject({ code: "forbidden" });
  });

    it("rejects tampering of ANY file, not just main (the manifest)", async () => {
        const pluginDir = await writePlugin("manifest-tamper", ["storage.read:posts"], {signed: true});
        // Escalate capabilities by editing the manifest after signing.
        await writeFile(
            join(pluginDir, "pressh.plugin.json"),
            JSON.stringify({
                name: "manifest-tamper",
                version: "0.0.0",
                main: "index.mjs",
                capabilities: ["storage.write:users"]
            }),
            "utf8",
        );
        const host = new PluginHost({
            storage,
            audit,
            allowUnsigned: false,
            signingSecret: SIGNING_SECRET,
            workerScript: WORKER
        });
        await expect(host.register(pluginDir)).rejects.toMatchObject({code: "forbidden"});
    });

    it("rejects a plugin with a file added after signing (e.g. a malicious sibling import)", async () => {
        const pluginDir = await writePlugin("added-file", [], {signed: true});
        await writeFile(join(pluginDir, "evil.mjs"), "export const x = 1;", "utf8");
        const host = new PluginHost({
            storage,
            audit,
            allowUnsigned: false,
            signingSecret: SIGNING_SECRET,
            workerScript: WORKER
        });
        await expect(host.register(pluginDir)).rejects.toMatchObject({code: "forbidden"});
    });

    it("rejects a signature forged with a different key (the whole point of keying it)", async () => {
        const pluginDir = await writePlugin("forged", [], {signed: true});
        // The on-disk signature was made with SIGNING_SECRET; a host keyed with a
        // DIFFERENT secret must reject it — an attacker without the key cannot forge.
        const host = new PluginHost({
            storage,
            audit,
            allowUnsigned: false,
            signingSecret: "a-totally-different-secret",
            workerScript: WORKER
        });
        await expect(host.register(pluginDir)).rejects.toMatchObject({code: "forbidden"});
    });

    it("fails closed: a signature present but no signing key configured is refused in production", async () => {
        const pluginDir = await writePlugin("nokey", [], {signed: true});
        const host = new PluginHost({storage, audit, allowUnsigned: false, workerScript: WORKER});
        await expect(host.register(pluginDir)).rejects.toMatchObject({code: "forbidden"});
    });

    it("signs and verifies all auxiliary files (e.g. designer presets), rejecting a tampered one", async () => {
        const preset = [{id: "p", name: "P", icon: "x", category: "C", description: "d", template: []}];
        const okHost = new PluginHost({
            storage,
            audit,
            allowUnsigned: false,
            signingSecret: SIGNING_SECRET,
            workerScript: WORKER
        });
        const okDir = await writePlugin("preset-ok", [], {signed: true, presets: preset});
        await expect(okHost.register(okDir)).resolves.toBeDefined();

        // Tampering presets.json after signing is rejected (every file is covered).
        await writeFile(join(okDir, "presets.json"), JSON.stringify([{id: "evil"}]), "utf8");
        const tamperHost = new PluginHost({
            storage,
            audit,
            allowUnsigned: false,
            signingSecret: SIGNING_SECRET,
            workerScript: WORKER
        });
        await expect(tamperHost.register(okDir)).rejects.toMatchObject({code: "forbidden"});
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
    it("registers disabled; enabling marks it enabled, disabling stops it", async () => {
        // Idle teardown off so this test reasons only about enable/disable.
        const host = new PluginHost({storage, audit, allowUnsigned: true, workerScript: WORKER, idleTimeoutMs: 0});
    const pluginDir = await writePlugin("toggle", []);

    await host.register(pluginDir);
    expect(host.isRegistered("toggle")).toBe(true);
        expect(host.has("toggle")).toBe(false); // registered but not enabled
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

    it("lazy-spawns: enabling starts no worker until the first invoke", async () => {
        const host = new PluginHost({storage, audit, allowUnsigned: true, workerScript: WORKER, idleTimeoutMs: 0});
        await host.load(await writePlugin("lazy", [])); // load = register + enable

        expect(host.has("lazy")).toBe(true); // enabled…
        expect(host.isRunning("lazy")).toBe(false); // …but no worker spawned yet

        expect(await host.invoke("lazy", "greet", {name: "go"})).toBe("GO");
        expect(host.isRunning("lazy")).toBe(true); // the invoke spawned it

        await host.stopAll();
    });

    it("tears an idle worker down after the timeout, then respawns it on the next call", async () => {
        const host = new PluginHost({
            storage,
            audit,
            allowUnsigned: true,
            workerScript: WORKER,
            idleTimeoutMs: 100,
        });
        await host.load(await writePlugin("idler", []));

        expect(await host.invoke("idler", "greet", {name: "one"})).toBe("ONE");
        expect(host.isRunning("idler")).toBe(true);

        // After the idle window the worker is reclaimed but the plugin stays enabled.
        await new Promise((r) => setTimeout(r, 300));
        expect(host.isRunning("idler")).toBe(false);
        expect(host.has("idler")).toBe(true);

        // The next call transparently respawns the worker.
        expect(await host.invoke("idler", "greet", {name: "two"})).toBe("TWO");
        expect(host.isRunning("idler")).toBe(true);
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

      // A fresh host (e.g. the Site process) sees the persisted state and treats
      // the plugin as enabled; the worker still spawns lazily on first invoke.
    const host2 = new PluginHost({ storage, audit, allowUnsigned: true, workerScript: WORKER, state });
    await host2.register(pluginDir);
      expect(host2.has("persisted")).toBe(true); // enabled from persisted state…
      expect(host2.isRunning("persisted")).toBe(false); // …but not spawned at register
      expect(await host2.invoke("persisted", "greet", {name: "z"})).toBe("Z"); // spawns on demand
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
    it("gates storage.list behind storage.read:* (deny then allow) and hides reserved collections", async () => {
    await storage.put("posts", { id: randomUUID(), title: "p" });
        // Seed auth-critical collections; a plugin must never even learn they exist.
        await storage.put("users", {id: randomUUID(), email: "a@b.c"});
        await storage.put("sessions", {id: randomUUID()});

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
        // Reserved collections are filtered out of the listing.
        expect(r2.collections).not.toContain("users");
        expect(r2.collections).not.toContain("sessions");
        expect(r2.collections).not.toContain("invites");
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
