import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import type {StorageAdapter} from "@pressh/core";
import {
    createAuthService,
    createCsrf,
    createFileAuditLog,
    createFileSecretsBackend,
    createFileSystemStorage,
    createMemberAuthService,
    totp,
} from "@pressh/core";
import type {AuthService, MemberAuthService, SecretsBackend} from "@pressh/core";
import {createContentService, createGdprService, createSettingsService, createThemeService} from "@pressh/engine";
import {createStudioApp} from "./app";
import {createMediaService} from "./media";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const DISGUISED = new TextEncoder().encode("#!/bin/sh");

let dir: string;
let storage: StorageAdapter;
let app: ReturnType<typeof createStudioApp>;

async function login(email: string, password: string): Promise<{ cookie: string; csrf: string; status: number }> {
  const res = await app.request("/admin/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = /pressh_session=([^;]+)/.exec(setCookie)?.[1] ?? "";
  const cookie = `pressh_session=${token}`;
  if (res.status !== 200) return { cookie, csrf: "", status: res.status };
  const me = (await (await app.request("/admin/api/me", { headers: { cookie } })).json()) as {
    csrfToken: string;
  };
  return { cookie, csrf: me.csrfToken, status: res.status };
}

function authHeaders(s: { cookie: string; csrf: string }): Record<string, string> {
  return { cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json" };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pressh-studio-"));
  storage = createFileSystemStorage({ root: join(dir, "content") });
  const audit = await createFileAuditLog({ path: join(dir, "audit.log") });
  const auth = await createAuthService({ storage, audit });
  await auth.createUser({ email: "owner@x.com", password: "ownerpass1", roles: ["owner"] });
  await auth.createUser({ email: "author@x.com", password: "authorpass1", roles: ["author"] });
  const content = createContentService({ storage, audit });
  const media = createMediaService({ storage, audit, mediaRoot: join(dir, "media") });
  const theme = createThemeService({ storage, audit });
  const settings = createSettingsService({ storage, audit });
  const csrf = createCsrf(randomBytes(32));
  app = createStudioApp({ auth, content, media, theme, settings, csrf, storage, audit });
});

afterEach(async () => {
  storage.close();
  await rm(dir, { recursive: true, force: true });
});

describe("studio auth", () => {
  it("serves the admin client", async () => {
    const res = await app.request("/admin");
      // The admin client is a React bundle built by `npm run build:admin` into
      // dist/admin-next.html. When the compiled bundle is present it is served
      // (200); in a bare test env (running TS source, no dist artifact) the route
      // returns a 503 with a build hint. Either way the route must be wired.
      expect([200, 503]).toContain(res.status);
      const body = await res.text();
      expect(res.status === 200 ? body.includes("Pressh") : body.includes("build:admin")).toBe(true);
  });

  it("requires a session for /me", async () => {
    expect((await app.request("/admin/api/me")).status).toBe(401);
  });

  it("logs in and returns capabilities + a CSRF token", async () => {
    const s = await login("owner@x.com", "ownerpass1");
    expect(s.status).toBe(200);
    expect(s.csrf).toBeTruthy();
  });

  it("rejects a mutation without a CSRF token", async () => {
    const s = await login("owner@x.com", "ownerpass1");
    const res = await app.request("/admin/api/types", {
      method: "POST",
      headers: { cookie: s.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "X", slug: "x", fields: [] }),
    });
    expect(res.status).toBe(403);
  });
});

describe("no-code flow (owner)", () => {
  it("models a type, authors a page with blocks, and publishes it", async () => {
    const s = await login("owner@x.com", "ownerpass1");

    const typeRes = await app.request("/admin/api/types", {
      method: "POST",
      headers: authHeaders(s),
      body: JSON.stringify({
        name: "Page",
        slug: "page",
        fields: [{ id: "1", name: "title", type: "text", required: true }],
      }),
    });
    const typeId = ((await typeRes.json()) as { data: { id: string } }).data.id;

    const entryRes = await app.request("/admin/api/content", {
      method: "POST",
      headers: authHeaders(s),
      body: JSON.stringify({
        typeId,
        slug: "about",
        fields: { title: "About" },
        blocks: [{ type: "paragraph", content: "hi<script>alert(1)</script>" }],
      }),
    });
    const entryId = ((await entryRes.json()) as { data: { id: string } }).data.id;

    const pubRes = await app.request(`/admin/api/content/${entryId}/publish`, {
      method: "POST",
      headers: authHeaders(s),
    });
    expect(((await pubRes.json()) as { data: { status: string } }).data.status).toBe("published");

    const list = (await (await app.request("/admin/api/content", { headers: { cookie: s.cookie } })).json()) as {
      items: { id: string }[];
    };
    expect(list.items.some((i) => i.id === entryId)).toBe(true);
  });

  it("uploads a valid image and rejects a disguised one", async () => {
    const s = await login("owner@x.com", "ownerpass1");

    const good = new FormData();
    good.append("file", new File([PNG], "logo.png", { type: "image/png" }));
    const okRes = await app.request("/admin/api/media", {
      method: "POST",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf },
      body: good,
    });
    expect(okRes.status).toBe(200);

    const bad = new FormData();
    bad.append("file", new File([DISGUISED], "evil.png", { type: "image/png" }));
    const badRes = await app.request("/admin/api/media", {
      method: "POST",
      headers: { cookie: s.cookie, "x-csrf-token": s.csrf },
      body: bad,
    });
    expect(badRes.status).toBe(400);
  });
});

describe("server-side capability enforcement (author)", () => {
  it("forbids an author from creating a type or publishing", async () => {
    const s = await login("author@x.com", "authorpass1");

    const typeRes = await app.request("/admin/api/types", {
      method: "POST",
      headers: authHeaders(s),
      body: JSON.stringify({ name: "X", slug: "x", fields: [] }),
    });
    expect(typeRes.status).toBe(403);
  });

  it("lets an author create content but not publish it", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const typeRes = await app.request("/admin/api/types", {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({
        name: "Note",
        slug: "note",
        fields: [{ id: "1", name: "title", type: "text", required: true }],
      }),
    });
    const typeId = ((await typeRes.json()) as { data: { id: string } }).data.id;

    const author = await login("author@x.com", "authorpass1");
    const entryRes = await app.request("/admin/api/content", {
      method: "POST",
      headers: authHeaders(author),
      body: JSON.stringify({ typeId, slug: "note-1", fields: { title: "t" } }),
    });
    expect(entryRes.status).toBe(200);
    const entryId = ((await entryRes.json()) as { data: { id: string } }).data.id;

    const pubRes = await app.request(`/admin/api/content/${entryId}/publish`, {
      method: "POST",
      headers: authHeaders(author),
    });
    expect(pubRes.status).toBe(403);
  });
});

describe("user administration", () => {
  it("forbids an author from listing users", async () => {
    const author = await login("author@x.com", "authorpass1");
    const res = await app.request("/admin/api/users", { headers: { cookie: author.cookie } });
    expect(res.status).toBe(403);
  });

  it("lists users and creates one with a temp password", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const listed = (await (await app.request("/admin/api/users", { headers: { cookie: owner.cookie } })).json()) as {
      users: { email: string }[];
    };
    expect(listed.users.length).toBe(2);

    const created = await app.request("/admin/api/users", {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({ email: "newbie@x.com", roles: ["editor"] }),
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as { data: { user: { mustChangePassword: boolean }; temporaryPassword: string } };
    expect(body.data.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(body.data.user.mustChangePassword).toBe(true);
  });

  it("refuses to disable the last active owner (409)", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const users = (await (await app.request("/admin/api/users", { headers: { cookie: owner.cookie } })).json()) as {
      users: { id: string; roles: string[] }[];
    };
    const ownerId = users.users.find((u) => u.roles.includes("owner"))!.id;
    const res = await app.request(`/admin/api/users/${ownerId}`, {
      method: "PUT",
      headers: authHeaders(owner),
      body: JSON.stringify({ status: "disabled" }),
    });
    expect(res.status).toBe(409);
  });

  it("invites a user and lets them accept it (public)", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const inviteRes = await app.request("/admin/api/users/invite", {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({ email: "invitee@x.com", roles: ["author"] }),
    });
    const { data } = (await inviteRes.json()) as { data: { token: string } };
    expect(data.token).toBeTruthy();

    const accept = await app.request("/admin/api/invite/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: data.token, password: "inviteepass1" }),
    });
    expect(accept.status).toBe(200);
    // The new account can now log in.
    const s = await login("invitee@x.com", "inviteepass1");
    expect(s.status).toBe(200);
  });
});

describe("settings", () => {
  it("reads and writes general settings", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const put = await app.request("/admin/api/settings", {
      method: "PUT",
      headers: authHeaders(owner),
      body: JSON.stringify({ baseUrl: "https://site.example", defaultLocale: "en-US", timezone: "UTC" }),
    });
    expect(put.status).toBe(200);
    const get = (await (await app.request("/admin/api/settings", { headers: { cookie: owner.cookie } })).json()) as {
      settings: { baseUrl: string };
    };
    expect(get.settings.baseUrl).toBe("https://site.example");
  });

  it("rejects an invalid base URL", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const put = await app.request("/admin/api/settings", {
      method: "PUT",
      headers: authHeaders(owner),
      body: JSON.stringify({ baseUrl: "not a url" }),
    });
    expect(put.status).toBe(400);
  });
});

describe("media library + audit", () => {
  it("lists, serves, and deletes media", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const form = new FormData();
    form.append("file", new File([PNG], "pic.png", { type: "image/png" }));
    const up = await app.request("/admin/api/media", {
      method: "POST",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
      body: form,
    });
    const mediaId = ((await up.json()) as { data: { id: string } }).data.id;

    const list = (await (await app.request("/admin/api/media", { headers: { cookie: owner.cookie } })).json()) as {
      items: { id: string }[];
    };
    expect(list.items.some((m) => m.id === mediaId)).toBe(true);

    const raw = await app.request(`/admin/api/media/${mediaId}/raw`, { headers: { cookie: owner.cookie } });
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toBe("image/png");

    const del = await app.request(`/admin/api/media/${mediaId}`, {
      method: "DELETE",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    });
    expect(del.status).toBe(200);
  });

  it("exposes the audit log to owners but not authors", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const ok = await app.request("/admin/api/audit?limit=5", { headers: { cookie: owner.cookie } });
    expect(ok.status).toBe(200);
    const author = await login("author@x.com", "authorpass1");
    const denied = await app.request("/admin/api/audit", { headers: { cookie: author.cookie } });
    expect(denied.status).toBe(403);
  });
});

describe("revisions", () => {
  it("lists and restores a prior revision", async () => {
    const owner = await login("owner@x.com", "ownerpass1");
    const typeRes = await app.request("/admin/api/types", {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({ name: "Doc", slug: "doc", fields: [{ id: "1", name: "title", type: "text", required: true }] }),
    });
    const typeId = ((await typeRes.json()) as { data: { id: string } }).data.id;
    const entryRes = await app.request("/admin/api/content", {
      method: "POST",
      headers: authHeaders(owner),
      body: JSON.stringify({ typeId, slug: "doc-1", fields: { title: "v1" }, blocks: [] }),
    });
    const entryId = ((await entryRes.json()) as { data: { id: string } }).data.id;
    await app.request(`/admin/api/content/${entryId}`, {
      method: "PUT",
      headers: authHeaders(owner),
      body: JSON.stringify({ fields: { title: "v2" }, blocks: [] }),
    });

    const revs = (await (await app.request(`/admin/api/content/${entryId}/revisions`, {
      headers: { cookie: owner.cookie },
    })).json()) as { items: { version: number }[] };
    expect(revs.items.length).toBe(2);

    const restore = await app.request(`/admin/api/content/${entryId}/revisions/1/restore`, {
      method: "POST",
      headers: authHeaders(owner),
    });
    expect(restore.status).toBe(200);
  });
});

describe("studio MFA endpoints (TOTP, vault-backed)", () => {
    let mdir: string;
    let mstorage: StorageAdapter;
    let secrets: SecretsBackend;
    let auth: AuthService;
    let mapp: ReturnType<typeof createStudioApp>;

    beforeEach(async () => {
        mdir = await mkdtemp(join(tmpdir(), "pressh-studio-mfa-"));
        mstorage = createFileSystemStorage({root: join(mdir, "content")});
        const audit = await createFileAuditLog({path: join(mdir, "audit.log")});
        secrets = await createFileSecretsBackend({path: join(mdir, "vault.json"), key: randomBytes(32)});
        auth = await createAuthService({storage: mstorage, audit, secrets});
        await auth.createUser({email: "admin@x.com", password: "adminpass1", roles: ["owner"]});
        const content = createContentService({storage: mstorage, audit, secrets});
        const media = createMediaService({storage: mstorage, audit, mediaRoot: join(mdir, "media")});
        const theme = createThemeService({storage: mstorage, audit});
        const settings = createSettingsService({storage: mstorage, audit});
        const csrf = createCsrf(randomBytes(32));
        mapp = createStudioApp({auth, content, media, theme, settings, csrf, storage: mstorage, audit, secrets});
    });

    afterEach(async () => {
        mstorage.close();
        await rm(mdir, {recursive: true, force: true});
    });

    async function loginSession(): Promise<{ cookie: string; csrf: string }> {
        const res = await mapp.request("/admin/api/auth/login", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email: "admin@x.com", password: "adminpass1"}),
        });
        const token = /pressh_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
        const cookie = `pressh_session=${token}`;
        const me = (await (await mapp.request("/admin/api/me", {headers: {cookie}})).json()) as { csrfToken: string };
        return {cookie, csrf: me.csrfToken};
    }

    async function enrollOverHttp(s: { cookie: string; csrf: string }): Promise<string> {
        const begin = await mapp.request("/admin/api/auth/mfa/begin", {
            method: "POST",
            headers: {cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json"},
        });
        const beginBody = (await begin.json()) as { data: { secret: string } };
        const secret = beginBody.data.secret;
        const confirm = await mapp.request("/admin/api/auth/mfa/confirm", {
            method: "POST",
            headers: {cookie: s.cookie, "x-csrf-token": s.csrf, "content-type": "application/json"},
            body: JSON.stringify({code: totp(secret)}),
        });
        expect(confirm.status).toBe(200);
        const confirmBody = (await confirm.json()) as { data: { recoveryCodes: string[] } };
        expect(confirmBody.data.recoveryCodes).toHaveLength(10);
        return secret;
    }

    it("enrolls over HTTP and then requires a code at login", async () => {
        const session = await loginSession();
        const secret = await enrollOverHttp(session);

        // Password step now returns a challenge and sets NO session cookie.
        const pwRes = await mapp.request("/admin/api/auth/login", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email: "admin@x.com", password: "adminpass1"}),
        });
        expect(pwRes.headers.get("set-cookie")).toBeNull();
        const challengeBody = (await pwRes.json()) as { mfaRequired?: boolean; challenge?: string };
        expect(challengeBody.mfaRequired).toBe(true);
        const challenge = challengeBody.challenge!;

        // Wrong code is refused.
        const bad = await mapp.request("/admin/api/auth/mfa/verify", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({challenge, code: "000000"}),
        });
        expect(bad.status).toBe(401);

        // Correct code completes the login and issues a working session.
        const ok = await mapp.request("/admin/api/auth/mfa/verify", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({challenge, code: totp(secret)}),
        });
        expect(ok.status).toBe(200);
        const token = /pressh_session=([^;]+)/.exec(ok.headers.get("set-cookie") ?? "")?.[1] ?? "";
        const me = await mapp.request("/admin/api/me", {headers: {cookie: `pressh_session=${token}`}});
        expect(me.status).toBe(200);
    });

    it("disables MFA with a valid code, reverting to single-factor login", async () => {
        const session = await loginSession();
        const secret = await enrollOverHttp(session);
        const dis = await mapp.request("/admin/api/auth/mfa/disable", {
            method: "POST",
            headers: {cookie: session.cookie, "x-csrf-token": session.csrf, "content-type": "application/json"},
            body: JSON.stringify({code: totp(secret)}),
        });
        expect(dis.status).toBe(200);

        // Login is single-factor again: a session cookie is set immediately.
        const res = await mapp.request("/admin/api/auth/login", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email: "admin@x.com", password: "adminpass1"}),
        });
        expect(res.headers.get("set-cookie")).toContain("pressh_session=");
    });

    it("rejects enrollment endpoints without a session/CSRF", async () => {
        const res = await mapp.request("/admin/api/auth/mfa/begin", {method: "POST"});
        expect(res.status).toBe(401);
    });
});

describe("studio member management", () => {
    let mdir: string;
    let mstorage: StorageAdapter;
    let memberAuth: MemberAuthService;
    let mapp: ReturnType<typeof createStudioApp>;

    async function makeMember(email: string): Promise<string> {
        const {member, verifyToken} = await memberAuth.register({email, password: "memberpass1", displayName: "M"});
        await memberAuth.verifyEmail({token: verifyToken});
        return member.id;
    }

    async function sessionFor(email: string, password: string): Promise<{ cookie: string; csrf: string }> {
        const res = await mapp.request("/admin/api/auth/login", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email, password}),
        });
        const token = /pressh_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
        const cookie = `pressh_session=${token}`;
        const me = (await (await mapp.request("/admin/api/me", {headers: {cookie}})).json()) as { csrfToken: string };
        return {cookie, csrf: me.csrfToken};
    }

    beforeEach(async () => {
        mdir = await mkdtemp(join(tmpdir(), "pressh-studio-members-"));
        mstorage = createFileSystemStorage({root: join(mdir, "content")});
        const audit = await createFileAuditLog({path: join(mdir, "audit.log")});
        const auth = await createAuthService({storage: mstorage, audit});
        await auth.createUser({email: "owner@x.com", password: "ownerpass1", roles: ["owner"]});
        await auth.createUser({email: "author@x.com", password: "authorpass1", roles: ["author"]});
        memberAuth = await createMemberAuthService({storage: mstorage, audit});
        const content = createContentService({storage: mstorage, audit});
        const media = createMediaService({storage: mstorage, audit, mediaRoot: join(mdir, "media")});
        const theme = createThemeService({storage: mstorage, audit});
        const settings = createSettingsService({storage: mstorage, audit});
        const gdpr = createGdprService({
            storage: mstorage,
            audit,
            scopes: [{collection: "form_submissions", subjectField: "subjectRef", timestampField: "at"}],
        });
        const csrf = createCsrf(randomBytes(32));
        mapp = createStudioApp({
            auth,
            content,
            media,
            theme,
            settings,
            csrf,
            storage: mstorage,
            audit,
            memberAuth,
            gdpr
        });
    });

    afterEach(async () => {
        mstorage.close();
        await rm(mdir, {recursive: true, force: true});
    });

    it("lets an owner list members but forbids an author", async () => {
        await makeMember("m1@example.com");
        const owner = await sessionFor("owner@x.com", "ownerpass1");
        const list = await mapp.request("/admin/api/members", {headers: {cookie: owner.cookie}});
        expect(list.status).toBe(200);
        const body = (await list.json()) as { data: { items: { email: string }[] } };
        expect(body.data.items.some((m) => m.email === "m1@example.com")).toBe(true);

        const author = await sessionFor("author@x.com", "authorpass1");
        const denied = await mapp.request("/admin/api/members", {headers: {cookie: author.cookie}});
        expect(denied.status).toBe(403);
    });

    it("suspends and reactivates a member", async () => {
        const id = await makeMember("m2@example.com");
        const owner = await sessionFor("owner@x.com", "ownerpass1");
        const hdr = {cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "application/json"};

        const sus = await mapp.request(`/admin/api/members/${id}/suspend`, {method: "POST", headers: hdr});
        expect(((await sus.json()) as { data: { status: string } }).data.status).toBe("suspended");
        // Suspended member can't log in on the site service.
        await expect(memberAuth.authenticate({
            email: "m2@example.com",
            password: "memberpass1"
        })).rejects.toMatchObject({code: "unauthorized"});

        const act = await mapp.request(`/admin/api/members/${id}/activate`, {method: "POST", headers: hdr});
        expect(((await act.json()) as { data: { status: string } }).data.status).toBe("active");
    });

    it("exports a member's data without the password hash", async () => {
        const id = await makeMember("m3@example.com");
        const owner = await sessionFor("owner@x.com", "ownerpass1");
        const res = await mapp.request(`/admin/api/members/${id}/export`, {headers: {cookie: owner.cookie}});
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { profile: Record<string, unknown>; data: unknown } };
        expect(body.data.profile["email"]).toBe("m3@example.com");
        expect(JSON.stringify(body.data)).not.toContain("passwordHash");
    });

    it("erases a member (right-to-be-forgotten)", async () => {
        const id = await makeMember("m4@example.com");
        const owner = await sessionFor("owner@x.com", "ownerpass1");
        const res = await mapp.request(`/admin/api/members/${id}/erase`, {
            method: "POST",
            headers: {cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "application/json"},
        });
        expect(res.status).toBe(200);
        expect(await memberAuth.getMember(id)).toBeNull();
    });

    it("requires CSRF for mutations", async () => {
        const id = await makeMember("m5@example.com");
        const owner = await sessionFor("owner@x.com", "ownerpass1");
        const res = await mapp.request(`/admin/api/members/${id}/suspend`, {
            method: "POST",
            headers: {cookie: owner.cookie, "content-type": "application/json"},
        });
        expect(res.status).toBe(403);
    });
});

describe("studio backups endpoints", () => {
    let bdir: string;
    let bstorage: StorageAdapter;
    let bapp: ReturnType<typeof createStudioApp>;
    let ran = 0;

    const fakeBackups = {
        dir: "/data/backups",
        intervalMs: 86_400_000,
        keep: 7,
        run: async () => {
            ran++;
            return {name: "backup-2026", items: 4, pruned: 1};
        },
        list: async () => [{name: "backup-2026", createdAt: "2026-05-27T00:00:00.000Z", sizeBytes: 2048}],
        verify: async () => ({ok: true, collections: {posts: 2}, totalRecords: 2, message: "ok"}),
    };

    async function sess(email: string, password: string): Promise<{ cookie: string; csrf: string }> {
        const res = await bapp.request("/admin/api/auth/login", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email, password}),
        });
        const token = /pressh_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
        const cookie = `pressh_session=${token}`;
        const me = (await (await bapp.request("/admin/api/me", {headers: {cookie}})).json()) as { csrfToken: string };
        return {cookie, csrf: me.csrfToken};
    }

    beforeEach(async () => {
        bdir = await mkdtemp(join(tmpdir(), "pressh-studio-bk-"));
        bstorage = createFileSystemStorage({root: join(bdir, "content")});
        const audit = await createFileAuditLog({path: join(bdir, "audit.log")});
        const auth = await createAuthService({storage: bstorage, audit});
        await auth.createUser({email: "owner@x.com", password: "ownerpass1", roles: ["owner"]});
        await auth.createUser({email: "author@x.com", password: "authorpass1", roles: ["author"]});
        const content = createContentService({storage: bstorage, audit});
        const media = createMediaService({storage: bstorage, audit, mediaRoot: join(bdir, "media")});
        const theme = createThemeService({storage: bstorage, audit});
        const settings = createSettingsService({storage: bstorage, audit});
        const csrf = createCsrf(randomBytes(32));
        ran = 0;
        bapp = createStudioApp({
            auth,
            content,
            media,
            theme,
            settings,
            csrf,
            storage: bstorage,
            audit,
            backups: fakeBackups
        });
    });

    afterEach(async () => {
        bstorage.close();
        await rm(bdir, {recursive: true, force: true});
    });

    it("lists backups + config for an owner, forbids an author", async () => {
        const owner = await sess("owner@x.com", "ownerpass1");
        const res = await bapp.request("/admin/api/backups", {headers: {cookie: owner.cookie}});
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { configured: boolean; keep: number; items: unknown[] } };
        expect(body.data.configured).toBe(true);
        expect(body.data.keep).toBe(7);
        expect(body.data.items).toHaveLength(1);

        const author = await sess("author@x.com", "authorpass1");
        const denied = await bapp.request("/admin/api/backups", {headers: {cookie: author.cookie}});
        expect(denied.status).toBe(403);
    });

    it("runs a backup now (CSRF required)", async () => {
        const owner = await sess("owner@x.com", "ownerpass1");
        const noCsrf = await bapp.request("/admin/api/backups/run", {method: "POST", headers: {cookie: owner.cookie}});
        expect(noCsrf.status).toBe(403);
        expect(ran).toBe(0);

        const ok = await bapp.request("/admin/api/backups/run", {
            method: "POST",
            headers: {cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "application/json"},
        });
        expect(ok.status).toBe(200);
        expect(((await ok.json()) as { data: { items: number } }).data.items).toBe(4);
        expect(ran).toBe(1);
    });

    it("runs a restore drill (verify)", async () => {
        const owner = await sess("owner@x.com", "ownerpass1");
        const res = await bapp.request("/admin/api/backups/verify", {
            method: "POST",
            headers: {cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "application/json"},
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { data: { ok: boolean; totalRecords: number } }).data).toMatchObject({
            ok: true,
            totalRecords: 2
        });
    });
});
