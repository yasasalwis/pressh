/**
 * Phase 2: Members-only content gating tests.
 *
 * Covers the front-controller membership gate, the built-in /account/login
 * form (GET + POST), and the /account/profile page.
 */
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {MemberAuthService, StorageAdapter} from "@pressh/core";
import {
    capabilitiesForRoles,
    createFileAuditLog,
    createFileSystemStorage,
    createMemberAuthService,
} from "@pressh/core";
import {createContentService, createQueryResolver} from "@pressh/engine";
import type {SitePluginHost} from "./app.js";
import {createSiteApp} from "./app.js";
import {createRenderCache} from "./cache.js";

const ADMIN = capabilitiesForRoles(["admin"]);
const EDITOR = capabilitiesForRoles(["editor"]);

const stubHost: SitePluginHost = {
    has: () => false,
    endpoints: () => [],
    invoke: async () => ({}),
};

const MEMBER = {
    email: "alice@example.com",
    password: "hunter2hunter2",
    displayName: "Alice",
};

let dir: string;
let storage: StorageAdapter;
let memberAuth: MemberAuthService;
let app: ReturnType<typeof createSiteApp>;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pressh-gating-"));
    storage = createFileSystemStorage({root: join(dir, "content")});
    const audit = await createFileAuditLog({path: join(dir, "audit.log")});
    const content = createContentService({storage, audit});
    const resolver = createQueryResolver({content});
    memberAuth = await createMemberAuthService({storage, audit});

    // Seed content types + pages.
    const type = await content.createType(ADMIN, {
        name: "Page",
        slug: "page",
        fields: [{id: "1", name: "title", type: "text", required: true}],
    });

    // Public page — no membership required.
    const publicEntry = await content.createEntry(EDITOR, {
        typeId: type.id,
        slug: "public-page",
        authorId: "u1",
        fields: {title: "Public"},
        blocks: [],
    });
    await content.transition(EDITOR, publicEntry.id, "published");

    // Members-only page.
    const privateEntry = await content.createEntry(EDITOR, {
        typeId: type.id,
        slug: "members-page",
        authorId: "u1",
        fields: {title: "Members only"},
        blocks: [],
    });
    await content.transition(EDITOR, privateEntry.id, "published");
    // Mark as members-only: read the post-transition (published) state so we
    // don't clobber the status that resolveBySlug filters on.
    const postTransition = await storage.get<Record<string, unknown>>("content_entries", privateEntry.id);
    if (postTransition.ok && postTransition.value) {
        await storage.put("content_entries", {...postTransition.value, requiresMembership: true});
    }

    app = createSiteApp({
        resolver,
        pluginHost: stubHost,
        cache: createRenderCache(),
        memberAuth,
    });
});

afterEach(async () => {
    storage.close();
    await rm(dir, {recursive: true, force: true});
});

// ---------------------------------------------------------------------------
// Public pages — must always be accessible anonymously
// ---------------------------------------------------------------------------

describe("public pages", () => {
    it("serves a public page to anonymous visitors", async () => {
        const res = await app.request("/public-page");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Public");
    });
});

// ---------------------------------------------------------------------------
// Members-only gating
// ---------------------------------------------------------------------------

describe("members-only gating", () => {
    it("redirects anonymous users to /account/login with ?next set", async () => {
        const res = await app.request("/members-page");
        expect(res.status).toBe(302);
        const location = res.headers.get("location") ?? "";
        expect(location).toContain("/account/login");
        expect(location).toContain(encodeURIComponent("/members-page"));
    });

    it("serves the page to an authenticated member", async () => {
        const {verifyToken} = await memberAuth.register(MEMBER);
        await memberAuth.verifyEmail({token: verifyToken});
        const {token} = await memberAuth.authenticate({email: MEMBER.email, password: MEMBER.password});

        const res = await app.request("/members-page", {
            headers: {cookie: `pressh_member=${token}`},
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Members only");
    });

    it("redirects if the session cookie is invalid", async () => {
        const res = await app.request("/members-page", {
            headers: {cookie: "pressh_member=bogus-token"},
        });
        expect(res.status).toBe(302);
        expect(res.headers.get("location") ?? "").toContain("/account/login");
    });

    it("does not gate a public page even when memberAuth is wired", async () => {
        const res = await app.request("/public-page");
        expect(res.status).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// /account/login — GET (render form)
// ---------------------------------------------------------------------------

describe("GET /account/login", () => {
    it("renders a login form", async () => {
        const res = await app.request("/account/login");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('<form');
        expect(html).toContain('method="POST"');
        expect(html).toContain('action="/account/login"');
        expect(html).toContain('type="email"');
        expect(html).toContain('type="password"');
    });

    it("includes the ?next param in the hidden field", async () => {
        const res = await app.request("/account/login?next=%2Fmembers-page");
        const html = await res.text();
        expect(html).toContain("/members-page");
    });

    it("rejects external next URLs (open redirect protection)", async () => {
        const res = await app.request("/account/login?next=https%3A%2F%2Fevil.com");
        const html = await res.text();
        // The next value must be sanitised to "/" not the external URL.
        expect(html).not.toContain("evil.com");
    });
});

// ---------------------------------------------------------------------------
// POST /account/login — form submission
// ---------------------------------------------------------------------------

describe("POST /account/login", () => {
    async function postLogin(email: string, password: string, next = "/") {
        const body = new URLSearchParams({email, password, next}).toString();
        return app.request("/account/login", {
            method: "POST",
            headers: {"content-type": "application/x-www-form-urlencoded"},
            body,
        });
    }

    it("sets a session cookie and redirects on valid credentials", async () => {
        const {verifyToken} = await memberAuth.register(MEMBER);
        await memberAuth.verifyEmail({token: verifyToken});

        const res = await postLogin(MEMBER.email, MEMBER.password, "/dashboard");
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/dashboard");
        const cookieHeader = res.headers.get("set-cookie") ?? "";
        expect(cookieHeader).toContain("pressh_member=");
        expect(cookieHeader).toContain("HttpOnly");
    });

    it("re-renders form with 401 on wrong password", async () => {
        const {verifyToken} = await memberAuth.register(MEMBER);
        await memberAuth.verifyEmail({token: verifyToken});

        const res = await postLogin(MEMBER.email, "wrongpassword");
        expect(res.status).toBe(401);
        const html = await res.text();
        expect(html).toContain("Invalid email or password");
        expect(html).toContain('<form');
    });

    it("re-renders form with 401 on unknown email", async () => {
        const res = await postLogin("ghost@example.com", "anypassword");
        expect(res.status).toBe(401);
        const html = await res.text();
        expect(html).toContain("Invalid email or password");
    });

    it("redirects to / when next param is external (open redirect protection)", async () => {
        const {verifyToken} = await memberAuth.register(MEMBER);
        await memberAuth.verifyEmail({token: verifyToken});

        const body = new URLSearchParams({
            email: MEMBER.email,
            password: MEMBER.password,
            next: "https://evil.com",
        }).toString();
        const res = await app.request("/account/login", {
            method: "POST",
            headers: {"content-type": "application/x-www-form-urlencoded"},
            body,
        });
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/");
    });
});

// ---------------------------------------------------------------------------
// GET /account/profile
// ---------------------------------------------------------------------------

describe("GET /account/profile", () => {
    it("redirects anonymous users to /account/login", async () => {
        const res = await app.request("/account/profile");
        expect(res.status).toBe(302);
        const location = res.headers.get("location") ?? "";
        expect(location).toContain("/account/login");
        expect(location).toContain(encodeURIComponent("/account/profile"));
    });

    it("renders the profile page for an authenticated member", async () => {
        const {verifyToken} = await memberAuth.register(MEMBER);
        await memberAuth.verifyEmail({token: verifyToken});
        const {token} = await memberAuth.authenticate({email: MEMBER.email, password: MEMBER.password});

        const res = await app.request("/account/profile", {
            headers: {cookie: `pressh_member=${token}`},
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Alice");
        expect(html).toContain("alice@example.com");
    });

    it("redirects with expired or invalid session cookie", async () => {
        const res = await app.request("/account/profile", {
            headers: {cookie: "pressh_member=not-a-real-token"},
        });
        expect(res.status).toBe(302);
        expect(res.headers.get("location") ?? "").toContain("/account/login");
    });
});
