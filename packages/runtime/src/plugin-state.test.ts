import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileSystemStorage } from "@pressh/core";
import type { StorageAdapter } from "@pressh/core";
import { createPluginStateStore } from "@pressh/runtime";

let dir: string;
let storage: StorageAdapter;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-state-"));
  storage = createFileSystemStorage({ root: join(dir, "_content") });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("PluginStateStore", () => {
  it("defaults to disabled for an unknown plugin (lean default)", async () => {
    const store = createPluginStateStore(storage);
    expect(await store.isEnabled("never-seen")).toBe(false);
  });

  it("round-trips enabled state and survives a fresh store over the same storage", async () => {
    const store = createPluginStateStore(storage);
    await store.setEnabled("inventory", true);
    expect(await store.isEnabled("inventory")).toBe(true);

    await store.setEnabled("inventory", false);
    expect(await store.isEnabled("inventory")).toBe(false);

    await store.setEnabled("inventory", true);
    // A new store instance (e.g. the other process) reads the persisted value.
    const reopened = createPluginStateStore(storage);
    expect(await reopened.isEnabled("inventory")).toBe(true);
  });
});
