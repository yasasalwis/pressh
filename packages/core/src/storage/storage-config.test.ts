import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {PressError} from "../errors.js";
import type {SecretsBackend} from "../secrets.js";
import type {StorageConfig, StorageFactory} from "./migrate.js";
import type {StorageAdapter} from "./types.js";
import {
    loadStorageConfig,
    resolveStorage,
    resolveStoragePath,
    saveStorageConfig,
    watchStorageConfig,
} from "./storage-config.js";

const stubAdapter = (): StorageAdapter =>
  ({
    get: async () => ({ ok: true, value: null }),
    put: async () => ({ ok: true, value: undefined }),
    delete: async () => ({ ok: true, value: undefined }),
    query: async () => ({ ok: true, value: { items: [], nextCursor: null } }),
    transaction: async (fn) => ({ ok: true, value: await fn(stubAdapter()) }),
    listCollections: async () => ({ ok: true, value: [] }),
    rebuildIndex: async () => ({ ok: true, value: undefined }),
    close: () => undefined,
  }) as StorageAdapter;

describe("storage-config", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-storagecfg-"));
    path = join(dir, "nested", "storage.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when the file is absent", async () => {
    expect(await loadStorageConfig(path)).toBeNull();
  });

  it("round-trips a config and stamps updatedAt", async () => {
    await saveStorageConfig(path, { backend: "postgres", credentialSecret: "storage.postgres.uri" });
    const loaded = await loadStorageConfig(path);
    expect(loaded?.backend).toBe("postgres");
    expect(loaded?.credentialSecret).toBe("storage.postgres.uri");
    expect(typeof loaded?.updatedAt).toBe("string");
  });

  it("writes via a temp file and leaves no .tmp behind", async () => {
    await saveStorageConfig(path, { backend: "sqlite", options: { path: "/data/db.sqlite" } });
    const body = JSON.parse(await readFile(path, "utf8")) as { backend: string };
    expect(body.backend).toBe("sqlite");
    await expect(readFile(`${path}.tmp`, "utf8")).rejects.toThrow();
  });

  it("rejects an unknown backend on load", async () => {
    await saveStorageConfig(path, { backend: "sqlite" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, JSON.stringify({ backend: "redis" }));
    await expect(loadStorageConfig(path)).rejects.toBeInstanceOf(PressError);
  });

  it("falls back to the filesystem adapter when no config is persisted", async () => {
    const factories: Record<string, StorageFactory> = {};
    const adapter = await resolveStorage({ persisted: null, contentRoot: join(dir, "content"), factories });
    const cols = await adapter.listCollections();
    expect(cols.ok).toBe(true);
    adapter.close();
  });

    it("anchors a relative backend path to the data dir, leaving absolute/:memory: alone", () => {
        expect(resolveStoragePath("/var/data", "db.sqlite")).toBe(join("/var/data", "db.sqlite"));
        expect(resolveStoragePath("/var/data", "nested/db.sqlite")).toBe(join("/var/data", "nested/db.sqlite"));
        expect(resolveStoragePath("/var/data", "/abs/db.sqlite")).toBe("/abs/db.sqlite");
        expect(resolveStoragePath("/var/data", ":memory:")).toBe(":memory:");
        // No baseDir → unchanged (caller opted out of anchoring).
        expect(resolveStoragePath(undefined, "db.sqlite")).toBe("db.sqlite");
    });

    it("rejects a relative path that escapes the data directory", () => {
        expect(() => resolveStoragePath("/var/data", "../../etc/cron.d/x")).toThrow(/escapes/i);
        expect(() => resolveStoragePath("/var/data", "../secret.sqlite")).toThrow(/escapes/i);
        // A path that resolves back inside the dir is fine.
        expect(resolveStoragePath("/var/data", "nested/../db.sqlite")).toBe(join("/var/data", "db.sqlite"));
    });

    it("forwards baseDir into the factory so a relative sqlite path can be anchored", async () => {
        let received: StorageConfig | null = null;
        const factories: Record<string, StorageFactory> = {
            sqlite: (c) => {
                received = c;
                return stubAdapter();
            },
        };
        await resolveStorage({
            persisted: {backend: "sqlite", options: {path: "db.sqlite"}},
            contentRoot: dir,
            baseDir: "/var/data",
            factories,
        });
        expect(received).not.toBeNull();
        expect((received as unknown as StorageConfig)["path"]).toBe("db.sqlite");
        expect((received as unknown as StorageConfig)["baseDir"]).toBe("/var/data");
    });

  it("passes non-secret options to a DB factory", async () => {
    let received: StorageConfig | null = null;
    const factories: Record<string, StorageFactory> = {
      mongo: (c) => {
        received = c;
        return stubAdapter();
      },
    };
    await resolveStorage({
      persisted: { backend: "mongo", options: { database: "presshprod" }, credentialSecret: "storage.mongo.url" },
      contentRoot: dir,
      secrets: fakeSecrets({ "storage.mongo.url": "mongodb://u:p@host/db" }),
      factories,
    });
    expect(received).not.toBeNull();
    expect((received as unknown as StorageConfig)["database"]).toBe("presshprod");
    expect((received as unknown as StorageConfig)["credential"]).toBe("mongodb://u:p@host/db");
  });

    it("fires the watcher when the config file is first created (fresh-install cutover)", async () => {
        let fired = 0;
        const stop = watchStorageConfig(path, () => (fired += 1), 30);
        await new Promise((r) => setTimeout(r, 80)); // establish baseline (absent)
        await saveStorageConfig(path, {backend: "sqlite", options: {path: "/x.sqlite"}});
        await new Promise((r) => setTimeout(r, 120));
        stop();
        expect(fired).toBe(1);
    });

    it("does not fire while the config file is unchanged", async () => {
        await saveStorageConfig(path, {backend: "sqlite"});
        let fired = 0;
        const stop = watchStorageConfig(path, () => (fired += 1), 30);
        await new Promise((r) => setTimeout(r, 150));
        stop();
        expect(fired).toBe(0);
    });

  it("throws when a DB backend needs credentials but no vault is configured", async () => {
    await expect(
      resolveStorage({
        persisted: { backend: "postgres", credentialSecret: "storage.postgres.uri" },
        contentRoot: dir,
        factories: { postgres: () => stubAdapter() },
      }),
    ).rejects.toBeInstanceOf(PressError);
  });
});

function fakeSecrets(values: Record<string, string>): SecretsBackend {
  return {
    setSecret: async () => undefined,
    getSecret: async (name) => {
      const v = values[name];
      if (v === undefined) throw new PressError("not_found", `no secret ${name}`);
      return v;
    },
    hasSecret: async (name) => name in values,
    deleteSecret: async () => undefined,
    listNames: async () => Object.keys(values),
    rotate: async () => undefined,
  };
}
