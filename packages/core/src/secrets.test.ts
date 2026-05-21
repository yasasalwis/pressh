import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createFileSecretsBackend, deriveMasterKey } from "@pressh/core";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-vault-"));
  path = join(dir, "vault.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileSecretsBackend", () => {
  it("round-trips a secret", async () => {
    const key = randomBytes(32);
    const vault = await createFileSecretsBackend({ path, key });
    await vault.setSecret("stripe", "sk_live_123");
    expect(await vault.getSecret("stripe")).toBe("sk_live_123");
  });

  it("persists secrets across instances with the same key", async () => {
    const key = randomBytes(32);
    await (await createFileSecretsBackend({ path, key })).setSecret("smtp", "pw");
    const reopened = await createFileSecretsBackend({ path, key });
    expect(await reopened.getSecret("smtp")).toBe("pw");
  });

  it("fails closed with the wrong master key", async () => {
    await (await createFileSecretsBackend({ path, key: randomBytes(32) })).setSecret("k", "v");
    const wrong = await createFileSecretsBackend({ path, key: randomBytes(32) });
    await expect(wrong.getSecret("k")).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rotate re-encrypts so only the new key works", async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const vault = await createFileSecretsBackend({ path, key: oldKey });
    await vault.setSecret("api", "secret");
    await vault.rotate(newKey);

    expect(await vault.getSecret("api")).toBe("secret"); // same instance, new key
    await expect(
      (await createFileSecretsBackend({ path, key: oldKey })).getSecret("api"),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(await (await createFileSecretsBackend({ path, key: newKey })).getSecret("api")).toBe(
      "secret",
    );
  });

  it("throws not_found for a missing secret", async () => {
    const vault = await createFileSecretsBackend({ path, key: randomBytes(32) });
    await expect(vault.getSecret("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a key of the wrong length", async () => {
    await expect(createFileSecretsBackend({ path, key: randomBytes(16) })).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("derives a stable 32-byte key from a passphrase", () => {
    const salt = randomBytes(16);
    const k1 = deriveMasterKey("correct horse battery staple", salt);
    const k2 = deriveMasterKey("correct horse battery staple", salt);
    expect(k1.length).toBe(32);
    expect(k1.equals(k2)).toBe(true);
  });
});
