import {timingSafeEqual} from "node:crypto";
import {readFile} from "node:fs/promises";
import type {Context, Next} from "hono";
import {Hono} from "hono";
import {deleteCookie, getCookie, setCookie} from "hono/cookie";
import type {AuditLog, AuthService, CsrfProtection, RoleName, StorageAdapter, User} from "@pressh/core";
import {CapabilityGate, createMetrics, createRateLimiter, PressError, requestId} from "@pressh/core";
import type {
  ContentEntry,
  ContentService,
  ContentStatus,
  FieldDef,
  GdprService,
  PrimitiveNode,
  PrimitiveRenderContext,
  SettingsService,
  ThemeService,
} from "@pressh/engine";
import {prebuiltLayoutBlocks, PRESETS, PRIMITIVE_DEFS, renderTree} from "@pressh/engine";
import type {CveService, PluginInfo} from "@pressh/runtime";
import {panelFrameTag, wrapPanelHtml} from "@pressh/runtime";
import type {MediaService} from "./media.js";
import {MAX_UPLOAD_BYTES} from "./media.js";
import type {MigrationLock} from "./migration-lock.js";
import type {DbManagerService, StartMigrationInput} from "./db-manager.js";

/** Constant-time string compare so a bearer-token check can't be timed out. */
function timingSafeStrEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Basic email shape check for the first-run setup wizard. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The first Owner is the most privileged account, so require a longer password than the 8-char floor. */
const MIN_OWNER_PASSWORD_LEN = 12;

// React admin bundle (built by scripts/build-admin.mjs into dist/admin-next.html,
// a sibling of this compiled module). Read once and cached; `null` when absent.
let _adminNextHtml: string | null | undefined;

async function readAdminNextHtml(): Promise<string | null> {
    if (_adminNextHtml !== undefined) return _adminNextHtml;
    try {
        _adminNextHtml = await readFile(new URL("admin-next.html", import.meta.url), "utf8");
    } catch {
        _adminNextHtml = null;
    }
    return _adminNextHtml;
}

/** Source of plugin admin panels (wired from the PluginHost in the bootstrap). */
export interface PanelProvider {
  list(): Promise<{ plugin: string; title: string }[]>;

    get(plugin: string): Promise<{ title: string; script: string } | null>;
}

/** Installed-plugin metadata for the Plugins screen (wired from the PluginHost). */
export interface PluginInfoProvider {
  list(): Promise<PluginInfo[]>;
}

/** Runtime enable/disable + panel-bridge control over the PluginHost. */
export interface PluginControlProvider {
  isRegistered(name: string): boolean;
  enable(name: string): Promise<void>;
  disable(name: string): Promise<void>;
  /** Handler names a plugin's panel is allowed to invoke (default-deny). */
  panelActions(name: string): string[];
  invoke(name: string, action: string, payload: unknown): Promise<unknown>;

  /** Designer presets contributed by enabled plugins (merged into the palette). */
  designerPresets?(): { plugin: string; presets: unknown[] }[];
}

const SESSION_COOKIE = "pressh_session";

export interface StudioAppDeps {
  auth: AuthService;
  content: ContentService;
  media: MediaService;
  theme: ThemeService;
  csrf: CsrfProtection;
  storage: StorageAdapter;
  audit: AuditLog;
  settings: SettingsService;
  panels?: PanelProvider;
  pluginInfo?: PluginInfoProvider;
  pluginControl?: PluginControlProvider;
  gdpr?: GdprService;
  cve?: CveService;
  /** When locked (during a DB migration), data-mutating admin routes return 409. */
  migrationLock?: MigrationLock;
  /** Database Manager: switch storage backend, migrate data, cut over. */
  dbManager?: DbManagerService;
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

export async function seedDemoContent(content: ContentService, ownerId: string, caps: string[]): Promise<void> {
  const pageFields: FieldDef[] = [{ id: "f0", name: "title", type: "text", required: true }];
  const pageType = await content.createType(caps, { name: "Page", slug: "page", fields: pageFields });

    // The demo pages ship as fully designed primitive trees (see
    // @pressh/engine prebuilt.ts), stored as a single `designer-layout` block, so a
    // fresh install presents a real, on-brand site the operator can edit visually.
  const pages: { slug: string; title: string; blocks: unknown[] }[] = [
      {slug: "home", title: "Home", blocks: prebuiltLayoutBlocks("home") ?? []},
      {slug: "about", title: "About", blocks: prebuiltLayoutBlocks("about") ?? []},
      {slug: "blog", title: "Blog", blocks: prebuiltLayoutBlocks("blog") ?? []},
      {slug: "contact", title: "Contact", blocks: prebuiltLayoutBlocks("contact") ?? []},
  ];

  for (const page of pages) {
    const entry = await content.createEntry(caps, {
      typeId: pageType.id,
      slug: page.slug,
      authorId: ownerId,
      fields: { title: page.title },
      blocks: page.blocks,
    });
    await content.transition(caps, entry.id, "published");
  }
}

export function createStudioApp(deps: StudioAppDeps): Hono<Vars> {
  const app = new Hono<Vars>();
  const gate = new CapabilityGate();
  const metrics = createMetrics();

  // Per-IP throttle for unauthenticated/sensitive endpoints (baseline #12).
  // Per-account lockout lives in the AuthService; this caps credential spraying
  // and write floods from a single source. Behind a proxy, x-forwarded-for is
  // the client; without one all requests share the "unknown" bucket (still capped).
  const authLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
  const clientKey = (c: Context<Vars>): string => {
    const xff = c.req.header("x-forwarded-for");
    return (xff ? (xff.split(",")[0] ?? "").trim() : "") || c.req.header("x-real-ip") || "unknown";
  };
  const rateLimit =
    (limiter: ReturnType<typeof createRateLimiter>) =>
    async (c: Context<Vars>, next: Next): Promise<Response | undefined> => {
      if (!limiter.check(clientKey(c))) {
        return c.json({ error: { code: "rate_limited", message: "Too many requests" } }, 429);
      }
      await next();
      return undefined;
    };

  // /metrics can expose request volumes/timings; require a bearer token when
  // PRESSH_METRICS_TOKEN is set (left open otherwise, to avoid breaking an
  // existing trusted-network scrape on upgrade).
  const metricsToken = process.env["PRESSH_METRICS_TOKEN"];

  // Request-id correlation + request metrics (TDD §9).
  app.use("*", async (c, next) => {
    c.header("x-request-id", requestId(c.req.header("x-request-id")));
    const start = Date.now();
    await next();
    metrics.inc("pressh_http_requests_total", "HTTP requests", { status: String(c.res.status) });
    metrics.observe("pressh_http_request_ms", "HTTP request duration (ms)", Date.now() - start);
  });

  // While a database migration is copying records, reject data-mutating admin
  // calls so nothing is written to the old store after the copy began (it would
  // be lost on cutover). Reads, the Database-Manager routes themselves, and
  // auth/session routes stay open so the operator can drive and monitor it.
  const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  app.use("*", async (c, next) => {
    if (deps.migrationLock?.isLocked() && MUTATING.has(c.req.method)) {
      const path = c.req.path;
      const exempt =
        path.startsWith("/admin/api/db") ||
        path.startsWith("/admin/api/auth") ||
        path.startsWith("/admin/api/me");
      if (path.startsWith("/admin/") && !exempt) {
        return c.json(
          { error: { code: "conflict", message: "A database migration is in progress. Try again shortly." } },
          409,
        );
      }
    }
    await next();
    return undefined;
  });

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    const probe = await deps.storage.listCollections();
    return probe.ok ? c.json({ status: "ready" }) : c.json({ status: "unavailable" }, 503);
  });
  app.get("/metrics", (c) => {
      if (metricsToken && !timingSafeStrEqual(c.req.header("authorization") ?? "", `Bearer ${metricsToken}`)) {
      return c.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
    }
    return c.text(metrics.render(), 200, { "content-type": "text/plain; version=0.0.4" });
  });

    // Session cookies must be Secure whenever the connection is HTTPS — not only
    // when NODE_ENV=production. Honoring x-forwarded-proto covers the common case
    // of a TLS-terminating proxy where the app itself sees plain HTTP; localhost
    // dev over HTTP still gets a usable (non-Secure) cookie.
    const cookieSecure = (c: Context<Vars>): boolean =>
        (deps.production ?? false) ||
        (c.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https");

    // First-run setup serializer (one Studio process): prevents a race where two
    // concurrent setup requests both create an Owner before either persists.
    let setupInFlight = false;

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

  /** Route-level capability guard. Use AFTER requireSession. */
  const requireCap =
    (capability: string) =>
    async (c: Context<Vars>, next: Next): Promise<Response | undefined> => {
      if (!gate.check(caps(c), capability)) {
        return c.json({ error: { code: "forbidden", message: "forbidden" } }, 403);
      }
      await next();
      return undefined;
    };

  async function run(c: Context<Vars>, fn: () => Promise<unknown>): Promise<Response> {
    try {
      const data = await fn();
      return c.json({ ok: true, data });
    } catch (error) {
      const { status, code } = mapError(error);
        const message =
            error instanceof PressError
                ? error.message
                : code === "internal"
                    ? "An unexpected error occurred. Please try again."
                    : code;
        return c.json({error: {code, message}}, status);
    }
  }

    // --- served admin client (React + TS, built by `npm run build:admin` into
    // dist/admin-next.html and inlined). Same-origin to /admin/api/*; the inline
    // bundle needs script-src 'unsafe-inline'. ---
    const serveAdmin = async (c: Context<Vars>): Promise<Response> => {
        const html = await readAdminNextHtml();
        if (!html) return c.text("Admin client not built — run: npm run build:admin", 503);
        c.header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; " +
            "img-src 'self' https: data:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'",
        );
        c.header("X-Content-Type-Options", "nosniff");
        return c.html(html);
    };
    app.get("/", serveAdmin);
    app.get("/admin", serveAdmin);

  // --- first-run setup wizard (WordPress-style) ---
  // Public, but works ONLY while zero users exist; permanently disabled after.
  app.get("/admin/api/setup/status", async (c) => {
    return c.json({ needsSetup: !(await deps.auth.hasAnyUser()) });
  });

  app.post("/admin/api/setup", rateLimit(authLimiter), async (c) => {
      // Synchronous guard (set before the first await) so two concurrent requests
      // on a fresh install can't both pass hasAnyUser() and create two Owners.
      if (setupInFlight) {
          return c.json({error: {code: "conflict", message: "Setup already in progress"}}, 409);
      }
      setupInFlight = true;
      try {
          if (await deps.auth.hasAnyUser()) {
              return c.json({error: {code: "conflict", message: "Already configured"}}, 409);
          }
          const {email, password} = await c.req.json<{ email: string; password: string }>();
          if (typeof email !== "string" || !EMAIL_RE.test(email)) {
              return c.json({error: {code: "validation", message: "A valid email is required"}}, 400);
          }
          if (typeof password !== "string" || password.length < MIN_OWNER_PASSWORD_LEN) {
              return c.json(
                  {
                      error: {
                          code: "validation",
                          message: `Owner password must be at least ${MIN_OWNER_PASSWORD_LEN} characters`,
                      },
                  },
                  400,
              );
          }
      await deps.auth.createUser({ email, password, roles: ["owner"] });
      const { token, user } = await deps.auth.authenticate({ email, password });
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "Lax",
          secure: cookieSecure(c),
        path: "/",
      });
      await seedDemoContent(deps.content, user.id, deps.auth.capabilitiesFor(user)).catch(() => {});
      await deps.content.ensureSystemPages(user.id).catch(() => {});
      return c.json({ user });
    } catch (error) {
      const { status, code } = mapError(error);
      return c.json({ error: { code, message: code } }, status);
      } finally {
          setupInFlight = false;
    }
  });

  // --- auth ---
  app.post("/admin/api/auth/login", rateLimit(authLimiter), async (c) => {
    const { email, password } = await c.req.json<{ email: string; password: string }>();
    try {
      const { token, user } = await deps.auth.authenticate({ email, password });
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "Lax",
          secure: cookieSecure(c),
        path: "/",
      });
      return c.json({ user });
    } catch (error) {
      const { status } = mapError(error);
      return c.json({ error: { code: "unauthorized", message: "Invalid credentials" } }, status);
    }
  });

    app.post("/admin/api/auth/logout", requireSession, requireCsrf, async (c) => {
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
    const safe = plugin.replace(/[^a-zA-Z0-9_-]/g, "");
    // Parent wrapper that embeds the panel in a sandbox WITHOUT allow-same-origin.
    // The bridge below is the panel's ONLY channel to the host: it validates the
    // message comes from our frame, then relays it to the cap-gated, CSRF-checked
    // invoke endpoint (which itself allow-lists handlers via panelActions).
    return c.html(
      `<!DOCTYPE html><meta charset="utf-8"><title>Plugin: ${safe}</title>` +
        `<style>html,body{margin:0;height:100%}</style>` +
        panelFrameTag(`/admin/plugins/${encodeURIComponent(plugin)}/panel`) +
        `<script>(function(){
  var frame=null, csrfP=null;
  function getFrame(){ if(!frame) frame=document.querySelector("iframe.pressh-panel"); return frame; }
  function getCsrf(){
    if(!csrfP) csrfP=fetch("/admin/api/me",{credentials:"same-origin"})
      .then(function(r){return r.json();}).then(function(b){return (b&&b.csrfToken)||"";})
      .catch(function(){return "";});
    return csrfP;
  }
  window.addEventListener("message", function(e){
    var m=e.data;
    if(!m||m.pressh!==true||typeof m.id!=="number"||typeof m.action!=="string") return;
    var f=getFrame();
    if(!f||e.source!==f.contentWindow) return;
    function reply(b){ e.source.postMessage(Object.assign({pressh:true,id:m.id},b),"*"); }
    getCsrf().then(function(csrf){
      return fetch(${JSON.stringify(`/admin/plugins/${encodeURIComponent(safe)}/invoke`)},{
        method:"POST",credentials:"same-origin",
        headers:{"content-type":"application/json","x-csrf-token":csrf},
        body:JSON.stringify({action:m.action,payload:m.payload})
      });
    }).then(function(res){
      return res.json().then(function(body){ return {ok:res.ok,body:body}; });
    }).then(function(r){
      if(r.ok&&r.body&&r.body.ok) reply({ok:true,result:r.body.data});
      else reply({ok:false,error:{message:(r.body&&r.body.error&&r.body.error.code)||"Request failed"}});
    }).catch(function(){ reply({ok:false,error:{message:"Request failed"}}); });
  });
})();</script>`,
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
      return c.html(wrapPanelHtml({title: panel.title, script: panel.script}));
  });

  // --- page designer: primitive library & live render ---
  // Resolves published entries' revision fields so CollectionList bindings
  // (title, …) populate — entries themselves only carry slug/publishedAt.
  function makeDesignerContext(): PrimitiveRenderContext {
    return {
      async listPublished(query) {
        const limit = Math.min(Math.max(1, query.limit ?? 10), 50);
        const result = await deps.storage.query(
          "content_entries",
          { where: { status: "published" } },
          { limit: 200 },
        );
        if (!result.ok) return [];
        const entries = (result.value.items as ContentEntry[]).slice();
        entries.sort((a, b) => {
          const av = a.publishedAt ?? "";
          const bv = b.publishedAt ?? "";
          return query.order === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        const items: Record<string, unknown>[] = [];
        for (const entry of entries.slice(0, limit)) {
          let fields: Record<string, unknown> = {};
          try {
            const rev = await deps.content.getRevision(entry.id, entry.currentRevision);
            fields = rev?.fields ?? {};
          } catch {
            fields = {};
          }
          items.push({
            ...fields,
            title: fields["title"] ?? entry.slug,
            slug: entry.slug,
            publishedAt: entry.publishedAt ?? "",
          });
        }
        return items;
      },
    };
  }

  // Palette: primitive defs + preset templates + theme tokens for the editor.
  // Presets from ENABLED plugins are merged in, so plugin-contributed widgets
  // (e.g. the inventory store blocks) appear only while their plugin is on.
  app.get("/admin/api/designer/library", requireSession, (c) => {
    const contributed = deps.pluginControl?.designerPresets?.() ?? [];
    const pluginPresets = contributed.flatMap((p) => p.presets);
    return c.json({
      primitives: PRIMITIVE_DEFS,
      presets: [...PRESETS, ...pluginPresets],
      themes: deps.theme.listThemes(),
    });
  });

  // Whole-tree live render for the canvas (editor mode → data-nid + placeholders).
  // Read-only (no mutation) so no CSRF; output is sanitized by the renderer.
  app.post("/admin/api/preview/render", requireSession, async (c) => {
    const body = await c.req.json<{ nodes: PrimitiveNode[] }>();
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
      try {
          // renderTree caps node count + nesting depth, so an oversized preview
          // body can't exhaust this (main-thread) request — it throws `validation`.
          const {html, css} = await renderTree(nodes, makeDesignerContext(), {editor: true});
          return c.json({html, css});
      } catch (error) {
          const {status, code} = mapError(error);
          return c.json({error: {code, message: code}}, status);
      }
  });

  // --- media upload (validated, stored outside web root) ---
  app.post("/admin/api/media", requireSession, requireCsrf, async (c) => {
    if (!gate.check(caps(c), "media.write")) {
      return c.json({ error: { code: "forbidden", message: "forbidden" } }, 403);
    }
      // Reject by declared size BEFORE parseBody buffers the whole multipart body
      // into memory. 64KB of slack covers multipart boundaries/headers so a file at
      // the limit still passes; the exact per-file check below is authoritative.
      const declaredLength = Number(c.req.header("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + 64 * 1024) {
          return c.json({error: {code: "validation", message: "File too large"}}, 413);
      }
    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) {
      return c.json({ error: { code: "validation", message: "Missing file" } }, 400);
    }
    // Reject oversized uploads before buffering the whole blob into memory.
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: { code: "validation", message: "File too large" } }, 413);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return run(c, () => deps.media.store(file.name, file.type, bytes, c.get("user").id));
  });

  // --- media library: list, serve, delete ---
  app.get("/admin/api/media", requireSession, requireCap("media.read"), async (c) =>
    c.json({ items: await deps.media.list() }),
  );

  // Authenticated raw file serving. Files live OUTSIDE any web root; this is the
  // only path that exposes them, and only to a capability-checked session.
  app.get("/admin/api/media/:id/raw", requireSession, requireCap("media.read"), async (c) => {
    const rec = await deps.media.get(c.req.param("id") ?? "");
    if (!rec) return c.text("Not found", 404);
    const buf = await readFile(rec.path);
    c.header("Content-Type", rec.mime);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Disposition", "inline");
    c.header("Cache-Control", "private, max-age=300");
    return c.body(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  });

  app.delete("/admin/api/media/:id", requireSession, requireCsrf, requireCap("media.write"), (c) =>
    run(c, () => deps.media.delete(c.req.param("id") ?? "", c.get("user").id).then(() => ({ ok: true }))),
  );

  // --- revisions (immutable history per page) ---
  app.get("/admin/api/content/:id/revisions", requireSession, requireCap("content.read"), async (c) => {
    const revisions = await deps.content.listRevisions(c.req.param("id") ?? "");
    return c.json({ items: revisions });
  });

  app.post(
    "/admin/api/content/:id/revisions/:version/restore",
    requireSession,
    requireCsrf,
    async (c) =>
      run(c, () =>
        deps.content.restoreRevision(
          caps(c),
          c.req.param("id") ?? "",
          Number(c.req.param("version")),
          c.get("user").id,
        ),
      ),
  );

  // --- user & invite administration (gated by users.manage) ---
  app.get("/admin/api/users", requireSession, requireCap("users.manage"), async (c) => {
    const [users, invites] = await Promise.all([deps.auth.listUsers(), deps.auth.listInvites()]);
    return c.json({ users, invites });
  });

  // Create a user with a generated temp password (the SMTP-less fallback). The
  // plaintext is returned once for the admin to relay.
  app.post("/admin/api/users", requireSession, requireCsrf, requireCap("users.manage"), async (c) => {
    const body = await c.req.json<{ email: string; roles: RoleName[] }>();
    return run(c, () =>
      deps.auth.adminCreateUser({ email: body.email, roles: body.roles, actorId: c.get("user").id }),
    );
  });

  app.put("/admin/api/users/:id", requireSession, requireCsrf, requireCap("users.manage"), async (c) => {
    const body = await c.req.json<{ roles?: RoleName[]; status?: "active" | "disabled" }>();
    return run(c, () => deps.auth.updateUser(c.req.param("id") ?? "", body, c.get("user").id));
  });

  // Invite a user (single-use, expiring token; they set their own password).
  app.post("/admin/api/users/invite", requireSession, requireCsrf, requireCap("users.manage"), async (c) => {
    const body = await c.req.json<{ email: string; roles: RoleName[] }>();
    return run(c, () => deps.auth.createInvite({ email: body.email, roles: body.roles, actorId: c.get("user").id }));
  });

  app.delete("/admin/api/invites/:id", requireSession, requireCsrf, requireCap("users.manage"), (c) =>
    run(c, () => deps.auth.revokeInvite(c.req.param("id") ?? "").then(() => ({ ok: true }))),
  );

  // Public: redeem an invitation. No session yet — the token IS the credential.
  app.post("/admin/api/invite/accept", rateLimit(authLimiter), async (c) => {
    const { token, password } = await c.req.json<{ token: string; password: string }>();
    try {
      const { token: session, user } = await deps.auth.acceptInvite({ token, password });
      setCookie(c, SESSION_COOKIE, session, {
        httpOnly: true,
        sameSite: "Lax",
          secure: cookieSecure(c),
        path: "/",
      });
      return c.json({ user });
    } catch (error) {
      const { status, code } = mapError(error);
      return c.json({ error: { code, message: code } }, status);
    }
  });

  // Self-service password change (any signed-in user; clears mustChangePassword).
  app.post("/admin/api/me/password", requireSession, requireCsrf, async (c) => {
    const { currentPassword, newPassword } = await c.req.json<{
      currentPassword: string;
      newPassword: string;
    }>();
    return run(c, () =>
      deps.auth.changePassword(c.get("user").id, currentPassword, newPassword).then(() => ({ ok: true })),
    );
  });

  // --- general settings (baseUrl, locale, timezone, SMTP) ---
  app.get("/admin/api/settings", requireSession, requireCap("settings.manage"), async (c) =>
    c.json({ settings: await deps.settings.getSettings() }),
  );

  app.put("/admin/api/settings", requireSession, requireCsrf, requireCap("settings.manage"), async (c) => {
    const body = await c.req.json();
    return run(c, () => deps.settings.updateSettings(caps(c), body));
  });

  // --- database manager: connectors, credential test, migrate, cleanup ---
  const dbUnavailable = (c: Context<Vars>): Response =>
      c.json({error: {code: "not_found", message: "Database manager not enabled"}}, 404);

  // Unlike the generic `run`, this surfaces the actual error message (not just the
  // code) so the operator sees WHY a connection/migration failed. Safe here: the
  // db-manager only throws curated, operator-facing PressError messages.
  const runDb = async (c: Context<Vars>, fn: () => Promise<unknown>): Promise<Response> => {
    try {
      return c.json({ok: true, data: await fn()});
    } catch (error) {
      const {status, code} = mapError(error);
      return c.json({error: {code, message: error instanceof PressError ? error.message : code}}, status);
    }
  };

  app.get("/admin/api/db/status", requireSession, requireCap("db.manage"), async (c) =>
      deps.dbManager ? run(c, () => deps.dbManager!.status()) : dbUnavailable(c),
  );

  app.get("/admin/api/db/migrate/status", requireSession, requireCap("db.manage"), (c) =>
      deps.dbManager ? c.json({ok: true, data: {migration: deps.dbManager.migrationStatus()}}) : dbUnavailable(c),
  );

  app.post("/admin/api/db/test", requireSession, requireCsrf, requireCap("db.manage"), async (c) => {
    if (!deps.dbManager) return dbUnavailable(c);
    const body = await c.req
        .json<{ backend?: unknown; values?: unknown }>()
        .catch(() => ({}) as { backend?: unknown; values?: unknown });
    return runDb(c, () =>
        deps.dbManager!.testConnection({
          backend: body.backend as StartMigrationInput["backend"],
          values: (body.values as Record<string, string>) ?? {},
        }),
    );
  });

  app.post("/admin/api/db/migrate", requireSession, requireCsrf, requireCap("db.manage"), async (c) => {
    if (!deps.dbManager) return dbUnavailable(c);
    const body = await c.req
        .json<Partial<StartMigrationInput>>()
        .catch(() => ({}) as Partial<StartMigrationInput>);
    return runDb(c, async () =>
        deps.dbManager!.startMigration(c.get("user").id, {
          backend: body.backend as StartMigrationInput["backend"],
          values: body.values ?? {},
          ...(body.removeOld !== undefined ? {removeOld: body.removeOld} : {}),
        }),
    );
  });

  app.post("/admin/api/db/cleanup", requireSession, requireCsrf, requireCap("db.manage"), async (c) => {
    if (!deps.dbManager) return dbUnavailable(c);
    const body = await c.req.json<{ keep?: boolean }>().catch(() => ({}) as { keep?: boolean });
    return runDb(c, () => deps.dbManager!.cleanup(c.get("user").id, {keep: body.keep === true}));
  });

  // --- audit log viewer (append-only, hash-chained) ---
  app.get("/admin/api/audit", requireSession, requireCap("audit.read"), async (c) => {
    const action = c.req.query("action");
    const limitRaw = Number(c.req.query("limit") ?? "200");
    const filter: { action?: string; limit: number } = {
      limit: Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 200,
    };
    if (action) filter.action = action;
    const entries = await deps.audit.query(filter);
    return c.json({ items: entries.reverse() }); // newest first
  });

  // --- installed plugins (capabilities + panel availability + enabled state) ---
  app.get("/admin/api/plugins", requireSession, requireCap("plugins.manage"), async (c) =>
    c.json({ items: deps.pluginInfo ? await deps.pluginInfo.list() : [] }),
  );

  // Enable a plugin: spawns its worker (and persists the state). Disabling does
  // the reverse — a disabled plugin runs no worker at all, keeping the app lean.
  app.post("/admin/api/plugins/:name/enable", requireSession, requireCsrf, requireCap("plugins.manage"), async (c) => {
    const name = c.req.param("name") ?? "";
    if (!deps.pluginControl?.isRegistered(name)) {
      return c.json({ error: { code: "not_found", message: "not_found" } }, 404);
    }
    return run(c, async () => {
      await deps.pluginControl!.enable(name);
      await deps.audit.append({ action: "plugin.enabled", actorId: c.get("user").id, detail: { plugin: name } });
      return { enabled: true };
    });
  });

  app.post("/admin/api/plugins/:name/disable", requireSession, requireCsrf, requireCap("plugins.manage"), async (c) => {
    const name = c.req.param("name") ?? "";
    if (!deps.pluginControl?.isRegistered(name)) {
      return c.json({ error: { code: "not_found", message: "not_found" } }, 404);
    }
    return run(c, async () => {
      await deps.pluginControl!.disable(name);
      await deps.audit.append({ action: "plugin.disabled", actorId: c.get("user").id, detail: { plugin: name } });
      return { enabled: false };
    });
  });

  // Panel bridge endpoint (ADR-005). The sandboxed panel iframe cannot reach the
  // network itself; its `presshPanel.request(action, payload)` is relayed by the
  // wrapper page to here. Default-deny: only handlers the plugin lists in its
  // manifest `panelActions` may run, and only with a valid session + CSRF token.
  app.post("/admin/plugins/:plugin/invoke", requireSession, requireCsrf, requireCap("plugins.manage"), async (c) => {
    const plugin = c.req.param("plugin") ?? "";
    if (!deps.pluginControl) return c.json({ error: { code: "not_found", message: "not_found" } }, 404);
    const body = await c.req
      .json<{ action?: unknown; payload?: unknown }>()
      .catch(() => ({}) as { action?: unknown; payload?: unknown });
    const action = typeof body.action === "string" ? body.action : "";
    if (!deps.pluginControl.panelActions(plugin).includes(action)) {
      return c.json({ error: { code: "forbidden", message: "Action not allowed" } }, 403);
    }
    return run(c, () => deps.pluginControl!.invoke(plugin, action, body.payload ?? {}));
  });

  return app;
}
