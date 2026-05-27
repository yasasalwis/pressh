/**
 * Member auth HTTP router — mounted at /api/members in the public site.
 *
 * Session management (pressh_member cookie) lives here, NOT in the
 * MemberAuthService, because cookie handling requires HTTP context.
 * The service is pure business logic; this module is the HTTP adapter.
 */
import type {Context} from "hono";
import {Hono} from "hono";
import {deleteCookie, getCookie, setCookie} from "hono/cookie";
import type {MemberAuthService} from "@pressh/core";
import {createRateLimiter, PressError} from "@pressh/core";
import type {EmailService, SettingsService} from "@pressh/engine";
import {magicLinkEmail, passwordResetEmail, verificationEmail,} from "@pressh/engine";

export const MEMBER_COOKIE = "pressh_member";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

// Auth-specific rate limiter: 10 requests per 15 minutes per IP.
// Separate from the site's general-purpose publicLimiter.
const authLimiter = createRateLimiter({limit: 10, windowMs: 15 * 60 * 1000});

function clientKey(c: Context): string {
    const xff = c.req.header("x-forwarded-for");
    return (xff ? (xff.split(",")[0] ?? "").trim() : "") || c.req.header("x-real-ip") || "unknown";
}

function rateLimited(c: Context): Response | null {
    if (!authLimiter.check(clientKey(c))) {
        return c.json({
            error: {
                code: "rate_limited",
                message: "Too many requests — please wait and try again"
            }
        }, 429) as unknown as Response;
    }
    return null;
}

function mapError(error: unknown): { status: 400 | 401 | 403 | 404 | 409 | 500; code: string; message: string } {
    if (error instanceof PressError) {
        if (error.code === "validation") return {status: 400, code: "validation", message: error.message};
        if (error.code === "unauthorized") return {status: 401, code: "unauthorized", message: error.message};
        if (error.code === "forbidden" || error.code === "capability_denied")
            return {status: 403, code: "forbidden", message: error.message};
        if (error.code === "not_found") return {status: 404, code: "not_found", message: error.message};
        if (error.code === "conflict") return {status: 409, code: "conflict", message: error.message};
    }
    return {status: 500, code: "internal", message: "An unexpected error occurred"};
}

export interface MemberRouterOptions {
    memberAuth: MemberAuthService;
    /** When absent email features (verification, magic link, pw reset) are skipped. */
    email?: EmailService;
    /** Used to resolve the site's base URL and display name for email content. */
    settings?: SettingsService;
    production?: boolean;
}

async function resolveSiteInfo(
    opts: MemberRouterOptions,
): Promise<{ baseUrl: string; siteName: string }> {
    if (!opts.settings) return {baseUrl: "", siteName: "Pressh"};
    try {
        const s = await opts.settings.getSettings();
        return {baseUrl: s.baseUrl.replace(/\/$/, ""), siteName: s.baseUrl || "Pressh"};
    } catch {
        return {baseUrl: "", siteName: "Pressh"};
    }
}

async function parseBody<T extends Record<string, unknown>>(c: Context): Promise<T> {
    try {
        return (await c.req.json()) as T;
    } catch {
        return {} as T;
    }
}

export function createMemberRouter(opts: MemberRouterOptions): Hono {
    const app = new Hono();

    // -------------------------------------------------------------------------
    // POST /api/members/register
    // -------------------------------------------------------------------------
    app.post("/register", async (c) => {
        const limited = rateLimited(c);
        if (limited) return limited;

        const body = await parseBody<{ email?: unknown; password?: unknown; displayName?: unknown }>(c);
        if (typeof body.email !== "string" || typeof body.password !== "string" || typeof body.displayName !== "string") {
            return c.json({error: {code: "validation", message: "email, password and displayName are required"}}, 400);
        }

        try {
            const {member, verifyToken} = await opts.memberAuth.register({
                email: body.email,
                password: body.password,
                displayName: body.displayName,
            });

            // Send verification email if SMTP is configured — best-effort, never fails registration.
            if (opts.email) {
                try {
                    const configured = await opts.email.isConfigured();
                    if (configured) {
                        const {baseUrl, siteName} = await resolveSiteInfo(opts);
                        const verifyUrl = `${baseUrl}/api/members/verify-email?token=${encodeURIComponent(verifyToken)}`;
                        const tpl = verificationEmail({verifyUrl, siteName});
                        await opts.email.send({to: member.email, subject: tpl.subject, html: tpl.html, text: tpl.text});
                    }
                } catch {
                    // Email failure must not block registration.
                }
            }

            return c.json({ok: true, member}, 201);
        } catch (err) {
            const {status, code, message} = mapError(err);
            return c.json({error: {code, message}}, status);
        }
    });

    // -------------------------------------------------------------------------
    // GET /api/members/verify-email?token=...
    // -------------------------------------------------------------------------
    app.get("/verify-email", async (c) => {
        const token = c.req.query("token");
        if (!token) {
            return c.json({error: {code: "validation", message: "token is required"}}, 400);
        }
        try {
            await opts.memberAuth.verifyEmail({token});
            // Redirect to home with a flag the frontend can show a toast for.
            return c.redirect("/?verified=1", 302);
        } catch (err) {
            const {status, code, message} = mapError(err);
            return c.json({error: {code, message}}, status);
        }
    });

    // -------------------------------------------------------------------------
    // POST /api/members/login
    // -------------------------------------------------------------------------
    app.post("/login", async (c) => {
        const limited = rateLimited(c);
        if (limited) return limited;

        const body = await parseBody<{ email?: unknown; password?: unknown }>(c);
        if (typeof body.email !== "string" || typeof body.password !== "string") {
            return c.json({error: {code: "validation", message: "email and password are required"}}, 400);
        }

        try {
            const {token, member} = await opts.memberAuth.authenticate({
                email: body.email,
                password: body.password,
            });
            setCookie(c, MEMBER_COOKIE, token, {
                httpOnly: true,
                sameSite: "Lax",
                secure: opts.production === true,
                maxAge: SESSION_MAX_AGE,
                path: "/",
            });
            return c.json({ok: true, member});
        } catch (err) {
            const {status, code, message} = mapError(err);
            return c.json({error: {code, message}}, status);
        }
    });

    // -------------------------------------------------------------------------
    // POST /api/members/logout
    // -------------------------------------------------------------------------
    app.post("/logout", async (c) => {
        const token = getCookie(c, MEMBER_COOKIE);
        if (token) {
            await opts.memberAuth.logout(token).catch(() => undefined);
        }
        deleteCookie(c, MEMBER_COOKIE, {path: "/"});
        return c.json({ok: true});
    });

    // -------------------------------------------------------------------------
    // POST /api/members/magic-link/request
    // -------------------------------------------------------------------------
    app.post("/magic-link/request", async (c) => {
        const limited = rateLimited(c);
        if (limited) return limited;

        const body = await parseBody<{ email?: unknown }>(c);
        if (typeof body.email !== "string") {
            return c.json({error: {code: "validation", message: "email is required"}}, 400);
        }

        // Anti-enumeration: always respond with 200 regardless of whether the email exists.
        try {
            const member = await opts.memberAuth.getMemberByEmail(body.email);
            if (member && opts.email) {
                const configured = await opts.email.isConfigured().catch(() => false);
                if (configured) {
                    const rawToken = await opts.memberAuth.issueMagicToken(member.id);
                    const {baseUrl, siteName} = await resolveSiteInfo(opts);
                    const magicUrl = `${baseUrl}/api/members/magic-link/verify?token=${encodeURIComponent(rawToken)}`;
                    const tpl = magicLinkEmail({magicUrl, siteName});
                    await opts.email.send({
                        to: member.email,
                        subject: tpl.subject,
                        html: tpl.html,
                        text: tpl.text
                    }).catch(() => undefined);
                }
            }
        } catch {
            // Never expose internal errors — still return 200.
        }

        return c.json({ok: true});
    });

    // -------------------------------------------------------------------------
    // GET /api/members/magic-link/verify?token=...
    // -------------------------------------------------------------------------
    app.get("/magic-link/verify", async (c) => {
        const token = c.req.query("token");
        if (!token) {
            return c.json({error: {code: "validation", message: "token is required"}}, 400);
        }
        try {
            const {token: sessionToken, member} = await opts.memberAuth.verifyMagicLink({token});
            setCookie(c, MEMBER_COOKIE, sessionToken, {
                httpOnly: true,
                sameSite: "Lax",
                secure: opts.production === true,
                maxAge: SESSION_MAX_AGE,
                path: "/",
            });
            // Redirect to home; frontend can show a "You're in!" toast.
            void member; // suppress unused-var lint
            return c.redirect("/?welcome=1", 302);
        } catch (err) {
            const {status, code, message} = mapError(err);
            return c.json({error: {code, message}}, status);
        }
    });

    // -------------------------------------------------------------------------
    // POST /api/members/password/reset  (request reset email)
    // -------------------------------------------------------------------------
    app.post("/password/reset", async (c) => {
        const limited = rateLimited(c);
        if (limited) return limited;

        const body = await parseBody<{ email?: unknown }>(c);
        if (typeof body.email !== "string") {
            return c.json({error: {code: "validation", message: "email is required"}}, 400);
        }

        // Anti-enumeration: always 200.
        try {
            const member = await opts.memberAuth.getMemberByEmail(body.email);
            if (member && opts.email) {
                const configured = await opts.email.isConfigured().catch(() => false);
                if (configured) {
                    const rawToken = await opts.memberAuth.issuePasswordResetToken(member.id);
                    const {baseUrl, siteName} = await resolveSiteInfo(opts);
                    // The reset link goes to a client-side page that renders the "new password" form.
                    const resetUrl = `${baseUrl}/account/reset-password?token=${encodeURIComponent(rawToken)}`;
                    const tpl = passwordResetEmail({resetUrl, siteName});
                    await opts.email.send({
                        to: member.email,
                        subject: tpl.subject,
                        html: tpl.html,
                        text: tpl.text
                    }).catch(() => undefined);
                }
            }
        } catch {
            // Never expose internal errors.
        }

        return c.json({ok: true});
    });

    // -------------------------------------------------------------------------
    // POST /api/members/password/confirm  (consume reset token + set new password)
    // -------------------------------------------------------------------------
    app.post("/password/confirm", async (c) => {
        const body = await parseBody<{ token?: unknown; newPassword?: unknown }>(c);
        if (typeof body.token !== "string" || typeof body.newPassword !== "string") {
            return c.json({error: {code: "validation", message: "token and newPassword are required"}}, 400);
        }
        try {
            const member = await opts.memberAuth.confirmPasswordReset({
                token: body.token,
                newPassword: body.newPassword,
            });
            return c.json({ok: true, member});
        } catch (err) {
            const {status, code, message} = mapError(err);
            return c.json({error: {code, message}}, status);
        }
    });

    // -------------------------------------------------------------------------
    // GET /api/members/me  (current member from session cookie)
    // -------------------------------------------------------------------------
    app.get("/me", async (c) => {
        const token = getCookie(c, MEMBER_COOKIE);
        if (!token) {
            return c.json({error: {code: "unauthorized", message: "Not authenticated"}}, 401);
        }
        const member = await opts.memberAuth.validateSession(token);
        if (!member) {
            deleteCookie(c, MEMBER_COOKIE, {path: "/"});
            return c.json({error: {code: "unauthorized", message: "Session expired"}}, 401);
        }
        return c.json({ok: true, member});
    });

    // -------------------------------------------------------------------------
    // PUT /api/members/me/profile  (update own profile)
    // -------------------------------------------------------------------------
    app.put("/me/profile", async (c) => {
        const token = getCookie(c, MEMBER_COOKIE);
        if (!token) {
            return c.json({error: {code: "unauthorized", message: "Not authenticated"}}, 401);
        }
        const member = await opts.memberAuth.validateSession(token);
        if (!member) {
            deleteCookie(c, MEMBER_COOKIE, {path: "/"});
            return c.json({error: {code: "unauthorized", message: "Session expired"}}, 401);
        }
        const body = await parseBody<{ displayName?: unknown; bio?: unknown }>(c);
        const input: { displayName?: string; bio?: string } = {};
        if (typeof body.displayName === "string") input.displayName = body.displayName;
        if (typeof body.bio === "string") input.bio = body.bio;

        try {
            const updated = await opts.memberAuth.updateProfile(member.id, input);
            return c.json({ok: true, member: updated});
        } catch (err) {
            const {status, code, message} = mapError(err);
            return c.json({error: {code, message}}, status);
        }
    });

    return app;
}

/** Extract and validate the member session from a Hono request context. */
export async function getMemberFromContext(
    c: Context,
    memberAuth: MemberAuthService,
): Promise<import("@pressh/core").Member | null> {
    const token = getCookie(c, MEMBER_COOKIE);
    if (!token) return null;
    return memberAuth.validateSession(token);
}
