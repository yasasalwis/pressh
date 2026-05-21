import { Hono } from "hono";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { CapabilityGate, PressError, createMetrics, requestId } from "@pressh/core";
import type { AuthService, CsrfProtection, StorageAdapter, User } from "@pressh/core";
import type { ContentService, ContentStatus, GdprService, ThemeService } from "@pressh/engine";
import { panelFrameTag, wrapPanelHtml } from "@pressh/runtime";
import type { CveService } from "@pressh/runtime";
import type { MediaService } from "./media.js";
import { ADMIN_HTML } from "./admin-html.js";

/** Source of plugin admin panels (wired from the PluginHost in the bootstrap). */
export interface PanelProvider {
  list(): Promise<{ plugin: string; title: string }[]>;
  get(plugin: string): Promise<{ title: string; html: string } | null>;
}

const SESSION_COOKIE = "pressh_session";

export interface StudioAppDeps {
  auth: AuthService;
  content: ContentService;
  media: MediaService;
  theme: ThemeService;
  csrf: CsrfProtection;
  storage: StorageAdapter;
  panels?: PanelProvider;
  gdpr?: GdprService;
  cve?: CveService;
  production?: boolean;
}

type Vars = { Variables: { user: User; token: string } };

function mapError(error: unknown): { status: 400 | 401 | 403 | 404 | 409 | 500; code: string } {
  const code = error instanceof PressError ? error.code : "internal";
  switch (code) {
    case "unauthorized":
      return { status: 401, code };
    case "forbidden":
    case "capability_denied":
      return { status: 403, code };
    case "not_found":
      return { status: 404, code };
    case "validation":
      return { status: 400, code };
    case "conflict":
      return { status: 409, code };
    default:
      return { status: 500, code };
  }
}

export function createStudioApp(deps: StudioAppDeps): Hono<Vars> {
  const app = new Hono<Vars>();
  const gate = new CapabilityGate();
  const metrics = createMetrics();

  // Request-id correlation + request metrics (TDD §9).
  app.use("*", async (c, next) => {
    c.header("x-request-id", requestId(c.req.header("x-request-id")));
    const start = Date.now();
    await next();
    metrics.inc("pressh_http_requests_total", "HTTP requests", { status: String(c.res.status) });
    metrics.observe("pressh_http_request_ms", "HTTP request duration (ms)", Date.now() - start);
  });

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    const probe = await deps.storage.listCollections();
    return probe.ok ? c.json({ status: "ready" }) : c.json({ status: "unavailable" }, 503);
  });
  app.get("/metrics", (c) =>
    c.text(metrics.render(), 200, { "content-type": "text/plain; version=0.0.4" }),
  );

  const requireSession = async (c: Context<Vars>, next: Next): Promise<Response | undefined> => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = token ? await deps.auth.validateSession(token) : null;
    if (!token || !user) {
      return c.json({ error: { code: "unauthorized", message: "Sign in required" } }, 401);
    }
    c.set("user", user);
    c.set("token", token);
    await next();
    return undefined;
  };

  const requireCsrf = async (c: Context<Vars>, next: Next): Promise<Response | undefined> => {
    if (!deps.csrf.verify(c.get("token"), c.req.header("x-csrf-token") ?? "")) {
      return c.json({ error: { code: "forbidden", message: "Invalid CSRF token" } }, 403);
    }
    await next();
    return undefined;
  };

  const caps = (c: Context<Vars>): string[] => deps.auth.capabilitiesFor(c.get("user"));

  async function run(c: Context<Vars>, fn: () => Promise<unknown>): Promise<Response> {
    try {
      const data = await fn();
      return c.json({ ok: true, data });
    } catch (error) {
      const { status, code } = mapError(error);
      return c.json({ error: { code, message: code } }, status);
    }
  }

  // --- served admin client ---
  app.get("/", (c) => c.html(ADMIN_HTML));
  app.get("/admin", (c) => c.html(ADMIN_HTML));

  // --- first-run setup wizard (WordPress-style) ---
  // Public, but works ONLY while zero users exist; permanently disabled after.
  app.get("/admin/api/setup/status", async (c) => {
    return c.json({ needsSetup: !(await deps.auth.hasAnyUser()) });
  });

  app.post("/admin/api/setup", async (c) => {
    if (await deps.auth.hasAnyUser()) {
      return c.json({ error: { code: "conflict", message: "Already configured" } }, 409);
    }
    const { email, password } = await c.req.json<{ email: string; password: string }>();
    try {
      await deps.auth.createUser({ email, password, roles: ["owner"] });
      const { token, user } = await deps.auth.authenticate({ email, password });
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: deps.production ?? false,
        path: "/",
      });
      return c.json({ user });
    } catch (error) {
      const { status, code } = mapError(error);
      return c.json({ error: { code, message: code } }, status);
    }
  });

  // --- auth ---
  app.post("/admin/api/auth/login", async (c) => {
    const { email, password } = await c.req.json<{ email: string; password: string }>();
    try {
      const { token, user } = await deps.auth.authenticate({ email, password });
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: deps.production ?? false,
        path: "/",
      });
      return c.json({ user });
    } catch (error) {
      const { status } = mapError(error);
      return c.json({ error: { code: "unauthorized", message: "Invalid credentials" } }, status);
    }
  });

  app.post("/admin/api/auth/logout", requireSession, async (c) => {
    await deps.auth.logout(c.get("token"));
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/admin/api/me", requireSession, (c) => {
    const user = c.get("user");
    return c.json({
      user,
      capabilities: deps.auth.capabilitiesFor(user),
      csrfToken: deps.csrf.issue(c.get("token")),
    });
  });

  // --- content types (no-code modeling) ---
  app.get("/admin/api/types", requireSession, async (c) => {
    if (!gate.check(caps(c), "content.read")) {
      return c.json({ error: { code: "forbidden", message: "forbidden" } }, 403);
    }
    const result = await deps.storage.query("content_types");
    return c.json({ items: result.ok ? result.value.items : [] });
  });

  app.post("/admin/api/types", requireSession, requireCsrf, async (c) => {
    const body = await c.req.json();
    return run(c, () => deps.content.createType(caps(c), body));
  });

  // --- content authoring ---
  app.get("/admin/api/content", requireSession, async (c) => {
    if (!gate.check(caps(c), "content.read")) {
      return c.json({ error: { code: "forbidden", message: "forbidden" } }, 403);
    }
    const result = await deps.storage.query("content_entries");
    return c.json({ items: result.ok ? result.value.items : [] });
  });

  // Single entry + its current revision (fields + blocks) for the editor to load.
  app.get("/admin/api/content/:id", requireSession, async (c) => {
    if (!gate.check(caps(c), "content.read")) {
      return c.json({ error: { code: "forbidden", message: "forbidden" } }, 403);
    }
    const entry = await deps.content.getEntry(c.req.param("id") ?? "");
    if (!entry) return c.json({ error: { code: "not_found", message: "not_found" } }, 404);
    const revision = await deps.content.getRevision(entry.id, entry.currentRevision);
    return c.json({
      entry,
      revision: revision ? { fields: revision.fields, blocks: revision.blocks } : { fields: {}, blocks: [] },
    });
  });

  app.post("/admin/api/content", requireSession, requireCsrf, async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return run(c, () =>
      deps.content.createEntry(caps(c), {
        typeId: String(body["typeId"]),
        slug: String(body["slug"]),
        authorId: c.get("user").id,
        fields: (body["fields"] as Record<string, unknown>) ?? {},
        ...(Array.isArray(body["blocks"]) ? { blocks: body["blocks"] as unknown[] } : {}),
        ...(typeof body["locale"] === "string" ? { locale: body["locale"] } : {}),
      }),
    );
  });

  app.put("/admin/api/content/:id", requireSession, requireCsrf, async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return run(c, () =>
      deps.content.saveEntry(caps(c), (c.req.param("id") ?? ""), {
        fields: (body["fields"] as Record<string, unknown>) ?? {},
        ...(Array.isArray(body["blocks"]) ? { blocks: body["blocks"] as unknown[] } : {}),
        editorId: c.get("user").id,
      }),
    );
  });

  app.post("/admin/api/content/:id/publish", requireSession, requireCsrf, (c) =>
    run(c, () => deps.content.transition(caps(c), (c.req.param("id") ?? ""), "published")),
  );

  app.post("/admin/api/content/:id/transition", requireSession, requireCsrf, async (c) => {
    const body = await c.req.json<{ to: ContentStatus; scheduledFor?: string }>();
    return run(c, () =>
      deps.content.transition(
        caps(c),
        (c.req.param("id") ?? ""),
        body.to,
        body.scheduledFor !== undefined ? { scheduledFor: body.scheduledFor } : {},
      ),
    );
  });

  // --- theming (no-code customizer) ---
  app.get("/admin/api/theme", requireSession, async (c) => {
    if (!gate.check(caps(c), "content.read")) {
      return c.json({ error: { code: "forbidden", message: "forbidden" } }, 403);
    }
    return c.json({ settings: await deps.theme.getSettings(), themes: deps.theme.listThemes() });
  });

  app.put("/admin/api/theme", requireSession, requireCsrf, async (c) => {
    const body = await c.req.json<{ theme?: string; tokens?: Record<string, string>; siteName?: string }>();
    return run(c, () => deps.theme.setSettings(caps(c), body));
  });

  // Live preview rendered into a sandboxed iframe (no mutation → no CSRF).
  app.post("/admin/api/theme/preview", requireSession, async (c) => {
    if (!gate.check(caps(c), "themes.manage")) {
      return c.json({ error: { code: "forbidden", message: "forbidden" } }, 403);
    }
    const body = await c.req.json<{ theme?: string; tokens?: Record<string, string>; siteName?: string }>();
    try {
      return c.json({ html: deps.theme.preview(body) });
    } catch (error) {
      const { status, code } = mapError(error);
      return c.json({ error: { code, message: code } }, status);
    }
  });

  // --- GDPR data-subject operations ---
  app.post("/admin/api/gdpr/export", requireSession, requireCsrf, async (c) => {
    if (!deps.gdpr) return c.json({ error: { code: "not_found", message: "GDPR not enabled" } }, 404);
    const { subjectRef } = await c.req.json<{ subjectRef: string }>();
    return run(c, () => deps.gdpr!.export(caps(c), subjectRef));
  });

  app.post("/admin/api/gdpr/erase", requireSession, requireCsrf, async (c) => {
    if (!deps.gdpr) return c.json({ error: { code: "not_found", message: "GDPR not enabled" } }, 404);
    const { subjectRef } = await c.req.json<{ subjectRef: string }>();
    return run(c, () => deps.gdpr!.erase(caps(c), subjectRef));
  });

  // --- plugin CVE status (supply-chain visibility, baseline #11) ---
  app.get("/admin/api/plugins/cve", requireSession, async (c) => {
    if (!gate.check(caps(c), "content.read")) {
      return c.json({ error: { code: "forbidden", message: "forbidden" } }, 403);
    }
    return c.json({ items: deps.cve ? await deps.cve.list() : [] });
  });

  // --- plugin admin panels (iframe-sandboxed, ADR-005) ---
  app.get("/admin/plugins", requireSession, async (c) => {
    return c.json({ items: deps.panels ? await deps.panels.list() : [] });
  });

  app.get("/admin/plugins/:plugin", requireSession, async (c) => {
    const plugin = c.req.param("plugin") ?? "";
    const panel = deps.panels ? await deps.panels.get(plugin) : null;
    if (!panel) return c.text("Not found", 404);
    // Parent wrapper that embeds the panel in a sandbox WITHOUT allow-same-origin.
    return c.html(
      `<!DOCTYPE html><meta charset="utf-8"><title>Plugin: ${plugin.replace(/[^a-zA-Z0-9_-]/g, "")}</title>` +
        panelFrameTag(`/admin/plugins/${encodeURIComponent(plugin)}/panel`),
    );
  });

  app.get("/admin/plugins/:plugin/panel", requireSession, async (c) => {
    const plugin = c.req.param("plugin") ?? "";
    const panel = deps.panels ? await deps.panels.get(plugin) : null;
    if (!panel) return c.text("Not found", 404);
    // Strict CSP: the panel may run inline script/style but cannot reach the
    // network or be framed by anything but the Studio.
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'self'",
    );
    c.header("X-Content-Type-Options", "nosniff");
    return c.html(wrapPanelHtml({ title: panel.title, body: panel.html }));
  });

  // --- media upload (validated, stored outside web root) ---
  app.post("/admin/api/media", requireSession, requireCsrf, async (c) => {
    if (!gate.check(caps(c), "media.write")) {
      return c.json({ error: { code: "forbidden", message: "forbidden" } }, 403);
    }
    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) {
      return c.json({ error: { code: "validation", message: "Missing file" } }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return run(c, () => deps.media.store(file.name, file.type, bytes, c.get("user").id));
  });

  return app;
}
