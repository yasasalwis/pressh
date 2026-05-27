import {describe, expect, it} from "vitest";
import type {SecretsBackend} from "@pressh/core";
import type {FieldDef} from "./types.js";
import {isEncRef, protectSensitive, redactEncRefs, revealEncRefs, SENSITIVE_MASK,} from "./sensitive.js";

/** Minimal in-memory vault for unit tests. */
function memSecrets(): SecretsBackend & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
        store,
        async setSecret(name, value) {
            store.set(name, value);
        },
        async getSecret(name) {
            const v = store.get(name);
            if (v === undefined) throw new Error("not found");
            return v;
        },
        async hasSecret(name) {
            return store.has(name);
        },
        async deleteSecret(name) {
            store.delete(name);
        },
        async listNames() {
            return [...store.keys()];
        },
        async rotate() {
            /* no-op */
        },
    };
}

const FIELDS: FieldDef[] = [
    {id: "f1", name: "title", type: "text", required: true},
    {id: "f2", name: "ssn", type: "text", required: false, sensitive: true},
];

describe("protectSensitive", () => {
    it("seals sensitive values and leaves others untouched", async () => {
        const secrets = memSecrets();
        const out = await protectSensitive({title: "Hi", ssn: "123-45-6789"}, FIELDS, secrets);
        expect(out["title"]).toBe("Hi");
        expect(isEncRef(out["ssn"])).toBe(true);
        const ref = out["ssn"] as { $enc: string };
        expect(ref.$enc.startsWith("field:")).toBe(true);
        expect(secrets.store.get(ref.$enc)).toBe("123-45-6789");
    });

    it("is a no-op when the type has no sensitive fields", async () => {
        const secrets = memSecrets();
        const plain: FieldDef[] = [{id: "f1", name: "title", type: "text", required: true}];
        const out = await protectSensitive({title: "Hi"}, plain, secrets);
        expect(out).toEqual({title: "Hi"});
        expect(secrets.store.size).toBe(0);
    });

    it("fails closed when a sensitive field exists but no vault is configured", async () => {
        await expect(
            protectSensitive({ssn: "secret"}, FIELDS, undefined),
        ).rejects.toMatchObject({code: "validation"});
    });

    it("does not re-seal an already-encrypted value", async () => {
        const secrets = memSecrets();
        const ref = {$enc: "field:existing"};
        const out = await protectSensitive({ssn: ref}, FIELDS, secrets);
        expect(out["ssn"]).toBe(ref);
        expect(secrets.store.size).toBe(0);
    });

    it("carries forward prior ciphertext when the incoming value is the mask", async () => {
        const secrets = memSecrets();
        const prior = {ssn: {$enc: "field:prev"}};
        const out = await protectSensitive({ssn: SENSITIVE_MASK}, FIELDS, secrets, prior);
        expect(out["ssn"]).toEqual({$enc: "field:prev"});
        expect(secrets.store.size).toBe(0); // never sealed the mask
    });

    it("nulls a masked value with no prior ciphertext (never seals the mask)", async () => {
        const secrets = memSecrets();
        const out = await protectSensitive({ssn: SENSITIVE_MASK}, FIELDS, secrets);
        expect(out["ssn"]).toBeNull();
        expect(secrets.store.size).toBe(0);
    });

    it("leaves empty/nullish sensitive values unsealed", async () => {
        const secrets = memSecrets();
        const out = await protectSensitive({ssn: ""}, FIELDS, secrets);
        expect(out["ssn"]).toBe("");
        expect(secrets.store.size).toBe(0);
    });
});

describe("revealEncRefs / redactEncRefs", () => {
    it("round-trips: seal then reveal returns the plaintext", async () => {
        const secrets = memSecrets();
        const sealed = await protectSensitive({ssn: "123-45-6789"}, FIELDS, secrets);
        const revealed = (await revealEncRefs(sealed, secrets)) as Record<string, unknown>;
        expect(revealed["ssn"]).toBe("123-45-6789");
    });

    it("redacts sealed refs to the mask without a key", () => {
        const redacted = redactEncRefs({a: {$enc: "field:x"}, b: "plain"}) as Record<string, unknown>;
        expect(redacted["a"]).toBe(SENSITIVE_MASK);
        expect(redacted["b"]).toBe("plain");
    });

    it("reveal masks when the secret is missing or the vault is absent", async () => {
        const secrets = memSecrets();
        expect(await revealEncRefs({$enc: "field:gone"}, secrets)).toBe(SENSITIVE_MASK);
        expect(await revealEncRefs({$enc: "field:gone"}, undefined)).toBe(SENSITIVE_MASK);
    });

    it("walks nested objects and arrays", async () => {
        const secrets = memSecrets();
        await secrets.setSecret("field:1", "one");
        const value = {list: [{$enc: "field:1"}, "two"], nested: {deep: {$enc: "field:1"}}};
        const revealed = (await revealEncRefs(value, secrets)) as {
            list: unknown[];
            nested: { deep: unknown };
        };
        expect(revealed.list[0]).toBe("one");
        expect(revealed.list[1]).toBe("two");
        expect(revealed.nested.deep).toBe("one");
    });
});
