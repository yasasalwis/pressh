import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {createFileSecretsBackend, deriveMasterKey, LEGACY_MASTER_KEY_SALT, openSecretsVault,} from "@pressh/core";

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

describe("openSecretsVault", () => {
    it("uses a raw 32-byte hex key verbatim (no KDF salt stamped)", async () => {
        const hex = randomBytes(32).toString("hex");
        const vault = await openSecretsVault({path, secret: hex});
        await vault!.setSecret("k", "v");
        const file = JSON.parse(await readFile(path, "utf8")) as { kdf?: unknown };
        expect(file.kdf).toBeUndefined();
        expect(await (await openSecretsVault({path, secret: hex}))!.getSecret("k")).toBe("v");
    });

    it("stamps a per-install random salt for a passphrase", async () => {
        const v1 = await openSecretsVault({path, secret: "shared passphrase"});
        await v1!.setSecret("k", "v");
        const file = JSON.parse(await readFile(path, "utf8")) as { kdf?: { salt: string } };
        expect(typeof file.kdf?.salt).toBe("string");

        // A second install with the SAME passphrase gets a DIFFERENT salt → different key.
        const path2 = join(dir, "vault2.json");
        await openSecretsVault({path: path2, secret: "shared passphrase"});
        const file2 = JSON.parse(await readFile(path2, "utf8")) as { kdf?: { salt: string } };
        expect(file2.kdf?.salt).not.toBe(file.kdf?.salt);
    });

    it("reopens a passphrase vault with the persisted salt", async () => {
        await (await openSecretsVault({path, secret: "hunter2 passphrase"}))!.setSecret("api", "secret");
        const reopened = await openSecretsVault({path, secret: "hunter2 passphrase"});
        expect(await reopened!.getSecret("api")).toBe("secret");
    });

    it("transparently migrates a legacy static-salt vault without data loss", async () => {
        // Seal a vault the old way: passphrase + the legacy static salt, no `kdf` field.
        const passphrase = "legacy operator passphrase";
        const legacyKey = deriveMasterKey(passphrase, LEGACY_MASTER_KEY_SALT);
        await (await createFileSecretsBackend({path, key: legacyKey})).setSecret("smtp", "old-pw");
        const before = JSON.parse(await readFile(path, "utf8")) as { kdf?: unknown };
        expect(before.kdf).toBeUndefined();

        // Opening via the new resolver migrates it: still readable, now salt-stamped.
        const migrated = await openSecretsVault({path, secret: passphrase});
        expect(await migrated!.getSecret("smtp")).toBe("old-pw");
        const after = JSON.parse(await readFile(path, "utf8")) as { kdf?: { salt: string } };
        expect(typeof after.kdf?.salt).toBe("string");

        // The legacy key no longer decrypts the re-encrypted vault.
        await expect(
            (await createFileSecretsBackend({path, key: legacyKey})).getSecret("smtp"),
        ).rejects.toMatchObject({code: "unauthorized"});
    });

    it("returns null for an absent/empty secret", async () => {
        expect(await openSecretsVault({path, secret: undefined})).toBeNull();
        expect(await openSecretsVault({path, secret: "  "})).toBeNull();
    });
});
