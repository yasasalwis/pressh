/**
 * Unit + integration tests for the forms plugin handlers (builtins/forms/index.mjs).
 *
 * Handlers are plain async functions — tested directly against an in-memory
 * HostApi stub (no worker thread). The integration block wires a REAL GdprService
 * as `host.pii` to prove sealed form PII is revealed by export and crypto-shredded
 * by erasure.
 */
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import type {AuditLog, SecretsBackend, StorageAdapter} from "@pressh/core";
import {
    capabilitiesForRoles,
    createFileAuditLog,
    createFileSecretsBackend,
    createFileSystemStorage,
} from "@pressh/core";
import {createGdprService} from "@pressh/engine";
import type {GdprService} from "@pressh/engine";

const {submit, list} = await import("./index.mjs");

const ADMIN = capabilitiesForRoles(["admin"]); // has gdpr.manage

function storageHost(storage: StorageAdapter, pii: unknown) {
    return {
        log: () => undefined,
        storage: {
            async get(collection: string, id: string) {
                const r = await storage.get(collection, id);
                return r.ok ? r.value : null;
            },
            async put(collection: string, doc: Record<string, unknown>) {
                await storage.put(collection, doc as never);
            },
            async delete(collection: string, id: string) {
                await storage.delete(collection, id);
            },
            async query(collection: string, where?: Record<string, unknown>, cursor?: { limit?: number }) {
                const r = await storage.query(collection, {where}, {limit: cursor?.limit ?? 500});
                return r.ok ? {items: r.value.items} : {items: []};
            },
        },
        pii,
    };
}

let dir: string;
let storage: StorageAdapter;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-forms-"));
    storage = createFileSystemStorage({root: join(dir, "data")});
});

afterEach(async () => {
    storage.close();
    await rm(dir, {recursive: true, force: true});
});

describe("forms submit — handler behaviour", () => {
    it("silently accepts a filled honeypot without storing anything", async () => {
        const protect = {
            calls: 0, async protect() {
                this.calls++;
                return {$enc: "x"};
            }, async recordConsent() {
            }
        };
        const host = storageHost(storage, protect);
        const res = (await submit({_hp: "i am a bot", fields: {email: "a@b.com"}}, host)) as { ok: boolean };
        expect(res.ok).toBe(true);
        const stored = await list({}, host);
        expect((stored as { items: unknown[] }).items).toEqual([]);
        expect(protect.calls).toBe(0);
    });

    it("seals declared-sensitive fields and leaves others plaintext", async () => {
        const sealed: Record<string, string> = {};
        const pii = {
            async protect(_subjectRef: string, value: string) {
                const ref = `field:${Object.keys(sealed).length}`;
                sealed[ref] = value;
                return {$enc: ref};
            },
            async recordConsent() {
            },
        };
        const host = storageHost(storage, pii);
        await submit(
            {
                formId: "contact",
                subjectRef: "alice@example.com",
                fields: {email: "alice@example.com", name: "Alice", ssn: "123-45-6789"},
                sensitiveFields: ["ssn"],
            },
            host,
        );
        const items = (await list({}, host)).items as { data: Record<string, unknown>; subjectRef: string }[];
        expect(items).toHaveLength(1);
        const doc = items[0]!;
        expect(doc.data["name"]).toBe("Alice"); // not sensitive → plaintext
        expect(doc.data["email"]).toBe("alice@example.com"); // subjectRef stays readable
        expect(doc.data["ssn"]).toEqual({$enc: "field:0"}); // sealed
        expect(JSON.stringify(doc)).not.toContain("123-45-6789");
        expect(sealed["field:0"]).toBe("123-45-6789");
    });

    it("records a consent record on opt-in, none otherwise", async () => {
        const consents: { subjectRef: string; scope: string; granted: boolean }[] = [];
        const pii = {
            async protect() {
                return {$enc: "x"};
            },
            async recordConsent(subjectRef: string, scope: string, granted: boolean) {
                consents.push({subjectRef, scope, granted});
            },
        };
        const host = storageHost(storage, pii);
        await submit({formId: "nl", subjectRef: "a@b.com", fields: {email: "a@b.com"}, consent: true}, host);
        await submit({formId: "nl", subjectRef: "c@d.com", fields: {email: "c@d.com"}, consent: false}, host);
        expect(consents).toEqual([{subjectRef: "a@b.com", scope: "form:nl", granted: true}]);
    });
});

describe("forms submit — GDPR integration (real GdprService as host.pii)", () => {
    let audit: AuditLog;
    let secrets: SecretsBackend;
    let gdpr: GdprService;

    beforeEach(async () => {
        audit = await createFileAuditLog({path: join(dir, "audit.log")});
        secrets = await createFileSecretsBackend({path: join(dir, "vault.json"), key: randomBytes(32)});
        gdpr = createGdprService({
            storage,
            audit,
            secrets,
            scopes: [{collection: "form_submissions", subjectField: "subjectRef", timestampField: "at"}],
        });
    });

    it("seals at rest, reveals on export, and crypto-shreds on erase", async () => {
        const host = storageHost(storage, gdpr);
        await submit(
            {
                formId: "contact",
                subjectRef: "carol@example.com",
                fields: {email: "carol@example.com", ssn: "999-88-7777"},
                sensitiveFields: ["ssn"],
                consent: true,
            },
            host,
        );

        // At rest: the plaintext SSN is nowhere in the raw stored row.
        const raw = await storage.query("form_submissions", {}, {limit: 10});
        const rawDoc = raw.ok ? (raw.value.items[0] as { data: Record<string, unknown> }) : null;
        expect((rawDoc!.data["ssn"] as { $enc?: string }).$enc).toBeDefined();
        expect(JSON.stringify(rawDoc)).not.toContain("999-88-7777");

        // Export reveals it for the data subject (Art. 15/20).
        const exported = await gdpr.export(ADMIN, "carol@example.com");
        const subs = exported.records["form_submissions"] as { data: Record<string, unknown> }[];
        expect(subs[0]!.data["ssn"]).toBe("999-88-7777");

        // A consent record was captured.
        const consents = exported.records["consent_records"] as { scope: string; granted: boolean }[];
        expect(consents.some((r) => r.scope === "form:contact" && r.granted)).toBe(true);

        // Erase deletes the row AND shreds the secret — a later reveal can't recover it.
        await gdpr.erase(ADMIN, "carol@example.com");
        const after = await storage.query("form_submissions", {}, {limit: 10});
        expect(after.ok ? after.value.items : []).toEqual([]);
        const refName = (rawDoc!.data["ssn"] as { $enc: string }).$enc;
        expect(await secrets.hasSecret(refName)).toBe(false);
    });
});
