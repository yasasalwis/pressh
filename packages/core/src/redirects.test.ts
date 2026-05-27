import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {AuditLog, RedirectService, StorageAdapter} from "@pressh/core";
import {createFileAuditLog, createFileSystemStorage, createRedirectService} from "@pressh/core";

let dir: string;
let storage: StorageAdapter;
let audit: AuditLog;
let svc: RedirectService;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-redirect-"));
    storage = createFileSystemStorage({root: join(dir, "content")});
    audit = await createFileAuditLog({path: join(dir, "audit.log")});
    svc = createRedirectService({storage, audit});
});

afterEach(async () => {
    storage.close();
    await rm(dir, {recursive: true, force: true});
});

describe("RedirectService", () => {
    it("creates and resolves an exact-path redirect (default 301)", async () => {
        const r = await svc.create({from: "/old", to: "/new"});
        expect(r.code).toBe(301);
        expect(await svc.resolve("/old")).toEqual({to: "/new", code: 301});
        expect(await svc.resolve("/unknown")).toBeNull();
    });

    it("normalizes trailing slashes on both store and lookup", async () => {
        await svc.create({from: "/legacy/", to: "https://example.com/x", code: 302});
        expect(await svc.resolve("/legacy")).toEqual({to: "https://example.com/x", code: 302});
        expect(await svc.resolve("/legacy/")).toEqual({to: "https://example.com/x", code: 302});
    });

    it("rejects bad sources/targets and self-redirects", async () => {
        await expect(svc.create({from: "no-slash", to: "/x"})).rejects.toMatchObject({code: "validation"});
        await expect(svc.create({from: "/x", to: "javascript:alert(1)"})).rejects.toMatchObject({code: "validation"});
        await expect(svc.create({from: "/x", to: "/x"})).rejects.toMatchObject({code: "validation"});
    });

    it("rejects a duplicate source", async () => {
        await svc.create({from: "/dup", to: "/a"});
        await expect(svc.create({from: "/dup", to: "/b"})).rejects.toMatchObject({code: "conflict"});
    });

    it("lists newest-first and removes by id", async () => {
        const a = await svc.create({from: "/a", to: "/1"});
        await svc.create({from: "/b", to: "/2"});
        expect((await svc.list()).map((r) => r.from)).toEqual(["/b", "/a"]);
        await svc.remove(a.id);
        expect((await svc.list()).map((r) => r.from)).toEqual(["/b"]);
        expect(await svc.resolve("/a")).toBeNull();
    });
});
