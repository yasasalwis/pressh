import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import type {StorageAdapter} from "@pressh/core";
import {createAuthService, createCsrf, createFileAuditLog, createFileSystemStorage} from "@pressh/core";
import {createContentService, createSettingsService, createThemeService} from "@pressh/engine";
import {createStudioApp} from "./app";
import {createMediaService} from "./media";
import {createMigrationLock} from "./migration-lock";
import type {DbManagerService} from "./db-manager";
import {createDbManager} from "./db-manager";
import {STORAGE_FACTORIES} from "./storage";

let dir: string;
let storage: StorageAdapter;
let app: ReturnType<typeof createStudioApp>;
let dbManager: DbManagerService;
let storageConfigPath: string;

async function login(email: string, password: string): Promise<{ cookie: string; csrf: string }> {
    const res = await app.request("/admin/api/auth/login", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({email, password}),
    });
    const token = /pressh_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const cookie = `pressh_session=${token}`;
    const me = (await (await app.request("/admin/api/me", {headers: {cookie}})).json()) as { csrfToken: string };
    return {cookie, csrf: me.csrfToken};
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-dbapi-"));
    storageConfigPath = join(dir, "storage.json");
    storage = createFileSystemStorage({root: join(dir, "content")});
    const audit = await createFileAuditLog({path: join(dir, "audit.log")});
    const auth = await createAuthService({storage, audit});
    await auth.createUser({email: "owner@x.com", password: "ownerpass1", roles: ["owner"]});
    await auth.createUser({email: "author@x.com", password: "authorpass1", roles: ["author"]});
    await storage.put("content_entries", {id: "e1", slug: "p1", status: "published"});
    const content = createContentService({storage, audit});
    const media = createMediaService({storage, audit, mediaRoot: join(dir, "media")});
    const theme = createThemeService({storage, audit});
    const settings = createSettingsService({storage, audit});
    const csrf = createCsrf(randomBytes(32));
    const migrationLock = createMigrationLock();
    dbManager = createDbManager({
        factories: STORAGE_FACTORIES,
        storage,
        audit,
        migrationLock,
        contentRoot: join(dir, "content"),
        mediaRoot: join(dir, "media"),
        auditPath: join(dir, "audit.log"),
        vaultPath: join(dir, "vault.json"),
        storageConfigPath,
        backupsDir: join(dir, "backups"),
        maintenancePropagationMs: 0,
    });
    app = createStudioApp({auth, content, media, theme, settings, csrf, storage, audit, migrationLock, dbManager});
});

afterEach(async () => {
    storage.close();
    await rm(dir, {recursive: true, force: true});
});

describe("database manager API", () => {
    it("requires a session", async () => {
        expect((await app.request("/admin/api/db/status")).status).toBe(401);
    });

    it("forbids users without db.manage", async () => {
        const s = await login("author@x.com", "authorpass1");
        expect((await app.request("/admin/api/db/status", {headers: {cookie: s.cookie}})).status).toBe(403);
    });

    it("returns connectors and the active backend", async () => {
        const s = await login("owner@x.com", "ownerpass1");
        const res = await app.request("/admin/api/db/status", {headers: {cookie: s.cookie}});
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            data: { active: { backend: string }; connectors: unknown[]; vaultConfigured: boolean }
        };
        expect(body.data.active.backend).toBe("fs");
        expect(body.data.connectors).toHaveLength(5);
        expect(body.data.vaultConfigured).toBe(false);
    });

    it("tests a connection", async () => {
        const s = await login("owner@x.com", "ownerpass1");
        const res = await app.request("/admin/api/db/test", {
            method: "POST",
            headers: {cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json"},
            body: JSON.stringify({backend: "sqlite", values: {path: join(dir, "probe.sqlite")}}),
        });
        expect(res.status).toBe(200);
        expect((await res.json()) as { data: unknown }).toEqual({ok: true, data: {ok: true}});
    });

    it("migrates end-to-end and exposes cleanup", async () => {
        const s = await login("owner@x.com", "ownerpass1");
        const start = await app.request("/admin/api/db/migrate", {
            method: "POST",
            headers: {cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json"},
            body: JSON.stringify({backend: "sqlite", values: {path: join(dir, "live.sqlite")}}),
        });
        expect(start.status).toBe(200);

        await dbManager.whenSettled();

        const statusRes = await app.request("/admin/api/db/migrate/status", {headers: {cookie: s.cookie}});
        const sBody = (await statusRes.json()) as { data: { migration: { phase: string } | null } };
        expect(sBody.data.migration?.phase).toBe("awaiting-restart");

        const cleanup = await app.request("/admin/api/db/cleanup", {
            method: "POST",
            headers: {cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json"},
            body: "{}",
        });
        expect(cleanup.status).toBe(200);
        expect((await cleanup.json()) as { data: { removed: boolean } }).toEqual({ok: true, data: {removed: true}});
    });

    it("rejects migrate without a CSRF token", async () => {
        const s = await login("owner@x.com", "ownerpass1");
        const res = await app.request("/admin/api/db/migrate", {
            method: "POST",
            headers: {cookie: s.cookie, "content-type": "application/json"},
            body: JSON.stringify({backend: "sqlite", values: {path: join(dir, "x.sqlite")}}),
        });
        expect(res.status).toBe(403);
    });
});
