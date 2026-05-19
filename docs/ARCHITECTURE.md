# Pressh — Architecture

> **Status:** Draft v0.3 · **Last updated:** 2026-05-19
>
> Pressh is a no-code CMS built on Next.js 16. **Its purpose is to be the WordPress alternative that does not leak data.** WordPress's plugin ecosystem is also its primary attack surface — plugins run in-process with full database and filesystem privileges, and the result is the steady drip of WordPress site compromises everyone in the industry has come to expect. Pressh inherits WordPress's UX (drop a plugin folder in and it works) without inheriting that security model.
>
> Decisions marked **[DECIDED]** are locked. **[OPEN]** items are still on the table.

---

## 1. Goals & non-goals

### Goals

1. **Secure by default.** A user installs Pressh, accepts the defaults, and is not vulnerable to the failure modes that compromise WordPress sites (plugin RCE, plugin SQL injection, IDOR via sequential IDs, REST user enumeration, file-upload RCE, in-process secret exposure, XSS via content).
2. **Plugin isolation is uniform.** Every plugin — first-party or third-party — runs in a worker thread with capability-gated RPC to the host. There is no privileged tier. If first-party code needs to do something a plugin can't, that work belongs in `core` or `engine`, not in a privileged plugin.
3. **Plugins are dropped in, not built in.** A user places a folder under `/plugins/<name>/` and the server picks it up at the next boot. No build step, no codegen, no redeploy. This is the WordPress UX that Pressh inherits.
4. **Self-hostable on modest hardware.** Default install runs on a single Node process with a local filesystem content store. No mandatory database.
5. **Optional scale path.** When the filesystem stops being enough, users plug in a database connector adapter without rewriting their site or plugins.
6. **Stable plugin API.** Plugin authors target `@pressh/sdk`, semver'd independently from core. Refactors inside core or engine must not break plugins.

### Non-goals (v1)

- Multi-tenant SaaS hosting. Self-host first.
- A custom rendering engine. We use React + Next.js.
- Backwards compatibility with WordPress plugins or themes.
- A built-in marketplace.
- A privileged "core extension" path that bypasses the plugin isolation model.

---

## 2. Architecture at a glance

```
┌─────────────────────────── Pressh host process (Node) ──────────────────────────────┐
│                                                                                     │
│   apps/studio (Vite SPA + Hono)          apps/site (Next.js 16)                     │
│   ─ admin UI (React 19 SPA)              ─ public SSR pages                         │
│   ─ Hono serves API + iframes            ─ catch-all routes                         │
│   ─ plugin/theme manager                 ─ themes                                   │
│        │                                       │                                    │
│        └─────────────────┐         ┌───────────┘                                    │
│                          ▼         ▼                                                │
│                    ┌──────────────────────┐                                         │
│                    │  @pressh/engine      │  content types, fields,                 │
│                    │                      │  queries, render, media, i18n           │
│                    └──────────┬───────────┘                                         │
│                               ▼                                                     │
│                    ┌──────────────────────┐                                         │
│                    │  @pressh/core        │  plugin host • hook bus • events        │
│                    │                      │  auth • permissions • secrets vault     │
│                    │                      │  audit log • storage interface          │
│                    └──────────┬───────────┘                                         │
│                               │ StorageAdapter                                      │
│                ┌──────────────┼──────────────────┐                                  │
│                ▼              ▼                  ▼                                  │
│          ┌──────────┐   ┌──────────┐       ┌──────────┐                             │
│          │ FS       │   │ Postgres │  ...  │ adapters │                             │
│          └──────────┘   └──────────┘       └──────────┘                             │
│                                                                                     │
│                          ▲                                                          │
│                          │ host-side SDK + capability gate                          │
│                          │ (structured-clone RPC over postMessage)                  │
│                          │                                                          │
│   ╔══════════════════════╪════════════════════════════════════════════════════╗     │
│   ║   Plugin workers (one Node worker_thread per plugin) — UNTRUSTED CODE     ║     │
│   ║                      ▼                                                    ║     │
│   ║   forms/  shop/  search/  ...  each runs `register(sdkProxy)`             ║     │
│   ║   no fs, no net, no env access except via declared capabilities           ║     │
│   ║   resource-limited (CPU, RAM, RPC budget per request)                     ║     │
│   ╚═══════════════════════════════════════════════════════════════════════════╝     │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘

      Browser
      ┌──────────────────────────────────────────────────────────┐
      │  Studio admin UI (Pressh-owned origin)                   │
      │   ┌──────────────────────────────────────────────────┐   │
      │   │  Plugin admin panel iframe                       │   │
      │   │  sandbox="allow-scripts allow-forms"             │   │
      │   │  strict CSP, no access to studio cookies         │   │
      │   │  postMessage RPC → studio → plugin worker        │   │
      │   └──────────────────────────────────────────────────┘   │
      └──────────────────────────────────────────────────────────┘
```

### Dependency direction (strict)

```
apps  ──▶  engine  ──▶  core
                ▲             ▲
                │             │
                └── sdk/host ─┘
                       ▲
                       │  (re-exports types only; runtime is in worker)
                       │
                  sdk/worker
                       ▲
                       │
                plugins, themes
```

- `core` depends on nothing Pressh-internal.
- `engine` depends on `core`.
- `sdk` ships **two** entry points: `@pressh/sdk` (worker-side, what plugins import — a proxy that RPCs to the host) and `@pressh/sdk/host` (host-side, used internally to register the RPC handlers).
- `apps/*` depend on `engine`.
- Plugins **must not** import `core` or `engine`. Lint rule + worker module resolver enforce it.

---

## 3. Package layout

```
pressh/
├── packages/
│   ├── core/                       @pressh/core
│   │   ├── kernel/                 boot, lifecycle, DI
│   │   ├── plugin-host/            worker spawning, lifecycle, supervision
│   │   ├── plugin-rpc/             host-side RPC dispatcher + capability gate
│   │   ├── hooks/                  async hook bus (workers)
│   │   ├── events/                 async pub/sub
│   │   ├── secrets/                sealed secrets vault
│   │   ├── audit/                  append-only audit log
│   │   ├── auth/                   identity, sessions, rate limit, lockout
│   │   ├── permissions/            capability + role checks
│   │   ├── storage/                StorageAdapter interface + FS adapter
│   │   ├── upload/                 magic-byte validation, quarantine
│   │   ├── logger/                 with PII redaction
│   │   └── errors/
│   │
│   ├── engine/                     @pressh/engine
│   │   ├── content-types/          schema registry
│   │   ├── fields/                 incl. `sensitive: true` encryption
│   │   ├── query/                  adapter-agnostic, public/admin scoped
│   │   ├── render/                 block + theme rendering
│   │   ├── sanitize/               per-block-type HTML sanitization
│   │   ├── media/                  uploads, transforms, CDN
│   │   ├── revisions/              history + drafts
│   │   ├── cache/                  hook-driven invalidation
│   │   ├── ids/                    UUID generator + signed-link helpers
│   │   └── i18n/
│   │
│   ├── sdk/                        @pressh/sdk
│   │   ├── worker/                 plugin-facing entry (proxy)
│   │   └── host/                   host-facing registration helpers
│   │
│   ├── runtime/                    @pressh/runtime
│   │   ├── worker-entry.ts         the file Node spawns inside each worker
│   │   └── iframe-shim/            tiny JS shim served to plugin admin iframes
│   │
│   └── ui-kit/                     @pressh/ui-kit (studio React components)
│
├── adapters/                       optional storage connectors
│   ├── postgres/
│   ├── sqlite/
│   └── mongo/
│
├── apps/
│   ├── studio/                     admin: Vite + Hono + React 19 SPA
│   └── site/                       public: Next.js 16 with SSR
│
├── plugins/                        user drops plugins here
├── themes/                         user drops themes here
├── content/                        default content store (FS adapter)
└── docs/
```

---

## 4. The kernel — `@pressh/core`

`core` is the smallest layer Pressh can run on. **No HTTP, no React, no content knowledge.** It loads plugins, brokers their RPC, and owns the security primitives.

### 4.1 Plugin host

`PluginHost` is the entry point. Responsibilities:

- Scan `/plugins/*/pressh.plugin.ts` at boot, validate manifests, semver-check `sdkVersion`, topologically sort by `dependencies`, refuse cycles.
- For each plugin: spawn a Node `worker_threads.Worker` running `@pressh/runtime/worker-entry.ts`, hand it the plugin's directory path and granted capability set, await its `ready` handshake.
- Maintain a per-plugin **`MessagePort`** for RPC, a **supervision policy** (max RAM, max CPU, max RPC budget per request), and a **degraded** state for plugins that crash or time out.
- On shutdown, signal each worker, await graceful exit, force-terminate after timeout.

Boot happens **exactly once per server process**, called from the server entry of each app (Hono `server.ts` for studio, Next.js `instrumentation.ts` `register()` for site). Studio and site are separate processes; each runs its own `PluginHost` with its own workers. See §10.

### 4.2 Plugin RPC dispatcher + capability gate

Every plugin → host call passes through `plugin-rpc`. A message looks like:

```
{ op: 'storage.put', args: { collection: 'posts', record: { … } }, callId: 17 }
```

The dispatcher:
1. Looks up `op` in the **registered RPC handler table** (populated by core + engine at boot).
2. Checks the calling plugin's granted capabilities. `storage.put` requires `storage.write:<collection>`. If the plugin lacks it, the dispatcher returns a typed error to the worker and writes a `capability.denied` entry to the audit log.
3. Invokes the handler, captures the result.
4. Returns `{ ok: true, result }` or `{ ok: false, error }` to the worker by `callId`.

Handlers run on the host event loop, so they have synchronous access to core/engine state. **The capability check is the only authorization point**; the handler itself trusts that it has been called by an authorized plugin.

### 4.3 Hook bus

WordPress-style hooks, two flavors, **both async because of the worker boundary**:

- **Actions** — fire-and-observe. `await hooks.do('content.saved', ctx)`. Listeners run in priority order; return values ignored; the host fans the message out to subscribed plugin workers in parallel and joins.
- **Filters** — value-transforming. `await hooks.filter('query.where', clause, ctx)`. Each listener gets the previous return value; chained serially. A listener that exceeds its time budget is killed and skipped (the unmodified value flows on); the audit log records it.

Hook payloads must be structured-clone-safe (no functions, no class instances, no DOM refs).

### 4.4 Events

`events` is async pub/sub for work that doesn't block the request — webhooks, search indexing, email, analytics. Listeners run after the originating request returns. A failing event listener never breaks a request; it's logged and the plugin is marked degraded if it fails repeatedly.

### 4.5 Secrets vault

Secrets (DB credentials, JWT signing keys, OAuth client secrets, third-party API keys) live **only** in core, never in `process.env` passed around in handler scope. The vault has a `SecretsBackend` interface so the storage substrate is pluggable:

```ts
interface SecretsBackend {
  get(name: string): Promise<Secret | null>;
  put(name: string, value: Secret, opts?: PutOpts): Promise<void>;
  delete(name: string): Promise<void>;
  rotate?(name: string): Promise<void>;
}
```

**v1 ships a file-based backend.** Secrets are encrypted at rest with AES-256-GCM. The master key is sourced from `PRESSH_MASTER_KEY` (env var) or, if absent, a key file at a path readable only by the Pressh process user. KMS / Vault / 1Password / Doppler backends are out of scope for v1 but can ship later as adapters; the interface exists from day one.

The public surface plugins see is unchanged:

```ts
secrets.put(name, value, { rotates?: Duration })
secrets.use(name, async (handle) => { /* one-shot scoped token */ })
```

Plugins request a secret by name via the SDK; the host checks `secret.read:<name>` capability, then either returns a **scoped, short-lived token** (for outbound HTTP that the host proxies) or, for secrets the plugin truly needs in cleartext (rare), the raw value with audit logging. The plugin **never sees** secrets it has no capability for.

### 4.6 Audit log

Append-only, separate from app logs. Records:

- Every mutation (who/what/before/after, content hash).
- Every capability use (which plugin called which RPC).
- Every login + privileged action.
- Every capability denial.

Rotated by size, optionally exported to an external sink (S3, Loki). Tampering-evident via hash chain. Plugins **cannot** write to the audit log directly.

### 4.7 Auth & permissions

- Auth identifies the actor (user or API token). Pluggable providers (local password, OAuth) ship as plugins — but the *enforcement* is in core. Rate limit + lockout are not opt-in.
- Permissions are capability-based: strings like `content.publish`, `plugin.install`, `media.delete`, `storage.write:posts`. Roles bundle capabilities. The check is `permissions.can(actor, capability, resource?)`.
- The **same capability vocabulary** governs plugin RPC and human actors; this keeps the audit story uniform.

### 4.8 Storage interface

```ts
interface StorageAdapter {
  get(collection: string, id: UUID): Promise<Record | null>;
  list(collection: string, q: Query): Promise<Page<Record>>;
  put(collection: string, record: Record): Promise<Record>;
  delete(collection: string, id: UUID): Promise<void>;

  capabilities: AdapterCapabilities;
  transaction?<T>(fn: TxFn<T>): Promise<T>;
}
```

The interface is **designed for the filesystem**, not for SQL. `list` accepts a typed `Query` object (filters, sorts, cursor pagination). SQL adapters translate to SQL.

**FS adapter index strategy:** the filesystem adapter mirrors indexed fields into a **SQLite sidecar** file living next to the content tree (e.g. `content/.pressh-index.db`). SQLite is bundled with Node-compatible bindings, ACID, and well-understood; cold start replays only what's missing rather than rescanning every record. An in-memory mirror on top is a perf optimization to add only if profiling demands it.

**Plugins never get raw query access by default.** An adapter may expose `raw()` for advanced use, but exercising it requires the `storage.raw` capability, which the studio installer surfaces with a loud warning. This single rule eliminates the plugin-SQL-injection class of WordPress vulnerabilities.

### 4.9 Background jobs

Plugins that need deferred or scheduled work (search indexing, email send, scheduled publish, webhook delivery) go through `core.jobs`, not their own timers:

```ts
jobs.schedule({ name: 'reindex', runAt: 'in 5 minutes', payload })
jobs.recurring({ name: 'send-digests', cron: '0 9 * * 1', payload })
```

Jobs are persisted to storage so they survive restart. A dedicated worker pool picks them up and dispatches them through the same capability-checked RPC path as inbound HTTP — a job is just a deferred invocation of a plugin endpoint. Plugins need `jobs.schedule` capability. The scheduler ships as a `JobBackend` interface with an in-process default; pluggable BullMQ / SQS / Temporal backends can ship later as adapters without changing plugin code.

---

## 5. The content runtime — `@pressh/engine`

`engine` turns `core` into a CMS. It owns "content type", "field", "block", "theme", "revision".

### 5.1 Content types and fields

A **content type** is a named schema. Built-ins: `page`, `post`, `media`. Plugins register more via `sdk.contentTypes.define(...)`.

A **field** is a typed slot with: validator (also produces JSON Schema for admin forms), storage encoder/decoder, admin component reference (rendered in a plugin iframe — see §11), optional render helpers.

Fields may carry `sensitive: true`. Sensitive fields are:

- Encrypted at rest with a key from the secrets vault.
- Redacted in audit logs and app logs.
- Gated by a separate `field.read.sensitive:<type>.<field>` capability — even an actor who can read the record cannot read sensitive fields without it.

### 5.2 IDs

All content IDs are **UUID v7** (time-ordered, unguessable). Pressh never exposes sequential IDs over a network. URL slugs are user-facing but separate from IDs; admin links to records use signed, short-TTL slugs that include the capability check.

### 5.3 Query resolver

```ts
engine.query('post')
  .where({ status: 'published' })
  .sort({ publishedAt: 'desc' })
  .limit(20)
  .run(actor);
```

Two execution modes:

- **Public scope** (no actor or unauthenticated) — query is wrapped: results filtered to `status === 'published'` AND any plugin-supplied scoping via the `query.where` filter. Plugins can add row-level restrictions but cannot remove them.
- **Admin scope** — same query, but the actor's capabilities are joined into the filter (`content.read.draft`, etc.). The wrapper is enforced at the engine level; plugins cannot bypass it.

### 5.4 Rendering & sanitization

Content is stored as **blocks**, never as raw HTML. Each block type declares its own sanitizer (rich-text blocks allow a tight allowlist; embed blocks restrict to a known origin list; code blocks render as text). Raw-HTML blocks exist but require the `content.html.write` capability on the editing actor *and* the content type opting into them — both, not either.

Themes are React component packages mapping block IDs to renderers. Plugins can override block components via the `block.component` filter, subject to capability.

### 5.5 Internationalization

**Per-locale records.** A piece of localized content is N records — one per locale — joined by a canonical `contentId`. Each record carries its own `locale` field, its own revisions, and renders at its own URL path (`/en/about`, `/fr/about`). Queries scope by locale by default; the engine knows the active request locale and filters automatically.

Rejected alternative: field-keyed locale maps (`title: { en, fr }`). That model has a "string or locale map" wart that complicates the field type system, indexing, and migration when a field switches between localized and non-localized. Per-locale records is the modern CMS norm (Sanity, Contentful) and keeps the field/query model simple.

Locale codes follow BCP 47. The engine handles fallback chains (`fr-CA` → `fr` → site default) at query time.

### 5.6 Revisions and media

- Every mutation produces an immutable revision. Hash-chained with audit log entries for the same change.
- Media uploads are validated by magic-byte sniffing, content-type sniffing, *and* extension whitelist. Files are stored outside any web-served root. Public access is via signed URLs from the media service, never direct filesystem paths.

---

## 6. Threat model

What Pressh defends against and what it does not. Naming this explicitly keeps future feature decisions honest.

### In scope

- **Malicious or compromised plugins.** A plugin acting in bad faith can do, at worst, what its granted capabilities allow — no more.
- **Vulnerable but well-intentioned plugins.** A plugin with a bug (SQL injection in plugin code, deserialization vuln, RCE in a dependency) is contained by the worker boundary and capability gate.
- **Untrusted content submitters.** Comments, form submissions, file uploads. Validated, sanitized, capability-checked.
- **Network-adjacent attackers.** TLS required; CSRF tokens on mutations; rate limiting + lockout on auth.
- **Curious anonymous users.** No content enumeration; no user enumeration; no draft leakage via guessable URLs.
- **Misconfigured operators.** Pressh refuses to start in production without TLS or behind a verified terminator. Default install does not expose admin on a guessable path.

### Out of scope (v1)

- **Compromise of the host OS / container.** If the box is rooted, no app-level mitigation matters.
- **Malicious first-party code.** We trust `core` and `engine`. (This is why the privileged-tier escape hatch was rejected — the trust boundary should be at the package layer, not within the plugin model.)
- **Side-channel attacks** between plugins via shared OS resources (CPU cache, scheduling). Worker threads share an OS process; this is acceptable for v1.
- **Denial-of-service against the public site at the network layer.** Pressh enforces per-plugin resource limits, but volumetric DDoS is upstream.

---

## 7. Secure-by-default baselines

These are **non-negotiable defaults**, locked into core. They cannot be disabled by configuration in v1.

| # | Default | Failure mode it closes |
|---|---|---|
| 1 | UUID v7 IDs for all content | IDOR via guessing |
| 2 | Public queries auto-filter to published; admin queries scoped by actor capability | Draft / private content leaks |
| 3 | No user enumeration on public endpoints; admin user listing requires capability and is paginated | `/wp-json/users` class |
| 4 | Block-based content with per-block sanitization; raw HTML requires capability on actor AND opt-in on content type | XSS via content |
| 5 | CSRF tokens on all state-changing requests; built into SDK so plugin authors can't forget | Cross-site request forgery |
| 6 | `sensitive: true` fields encrypted at rest, redacted in logs, separate capability to read | PII / secret leakage |
| 7 | Sealed secrets vault; no secrets in `process.env` flowing through handlers | wp-config-style exposure |
| 8 | Append-only, hash-chained audit log for mutations, capability uses, logins | Forensics + accountability |
| 9 | TLS required in production (refuse to start without HTTPS or verified terminator) | Network-layer leaks |
| 10 | Strict default CSP; plugins must declare external origins they fetch from | XSS / exfiltration |
| 11 | Plugin CVE feed; host refuses to load plugins with known vulnerabilities | Outdated-plugin attacks |
| 12 | Rate limits + lockout in auth core, not opt-in | Brute force / credential stuffing |
| 13 | Upload validation: magic-byte + content-type sniff + extension whitelist; files stored outside web roots | File-upload RCE |
| 14 | No raw DB access from plugins by default; `storage.raw` is a capability the user explicitly approves at install time | Plugin SQL injection |

---

## 8. Plugin isolation — the model

**[DECIDED]** Every plugin runs in its own Node `worker_threads.Worker`. No exceptions, no privileged tier.

### 8.1 Why uniform isolation, not tiered

A tiered model (first-party trusted, third-party isolated) creates a privileged path that someone will eventually try to bypass — either an attacker via a compromised first-party plugin, or a maintainer cutting corners. WordPress's failure is partly that there is no clean boundary between "core" and "plugin"; everything runs as the same PHP. Pressh draws the boundary at the package layer (`core`, `engine`, `apps` are trusted; everything in `/plugins/` is not) and enforces it uniformly. First-party code that needs unrestricted access belongs in `core` or `engine`, not in a privileged plugin.

### 8.2 Worker setup

Each worker is spawned with:

- `resourceLimits`: `maxOldGenerationSizeMb`, `maxYoungGenerationSizeMb`, `codeRangeSizeMb`. Caps RAM per plugin.
- A custom **module resolver** that restricts `import` to the plugin's own directory + the `@pressh/sdk` worker entry + an allowlist of safe Node stdlib modules (no `fs`, no `child_process`, no `worker_threads` recursion, no `vm`).
- No environment inherited from the parent (`env: {}` via worker options).
- A **message channel** (`MessagePort`) to the host plugin-rpc dispatcher.
- An **RPC budget** per request (max calls, max wall time). Exceeding it kills the worker for the current request; persistent offenders are quarantined.

### 8.3 Capability declarations

Plugin manifest declares everything it needs:

```ts
export default defineManifest({
  id: 'forms',
  version: '1.4.0',
  sdkVersion: '^1.0.0',
  needs: [
    'storage.read:forms',
    'storage.write:forms',
    'storage.read:submissions',
    'storage.write:submissions',
    'secret.read:smtp-credentials',
    'network.fetch:api.sendgrid.com',
  ],
  declares: {
    capabilities: ['forms.manage', 'forms.read'],
    contentTypes: ['form', 'submission'],
    endpoints: [{ path: 'submit', method: 'POST' }],
    adminPanels: [{ path: '/forms', title: 'Forms' }],
  },
  entry: './src/index.ts',
});
```

At install time the studio displays this manifest to an admin user, who explicitly approves the capability grants. Capabilities can be revoked from the studio later; the plugin worker is restarted with the new set.

### 8.4 What plugins can and cannot do, concretely

| Plugins **can** | Plugins **cannot** |
|---|---|
| Read/write content via `sdk.storage.*` (capability-checked per collection) | Open files outside their plugin folder |
| Register hook listeners (async) | Open arbitrary sockets / DNS |
| Fetch from declared external origins via `sdk.fetch` (proxied through host) | Read `process.env` |
| Request secrets by name (capability-checked) | Spawn processes or threads |
| Register content types, fields, endpoints, admin panels | Modify the audit log |
| Render blocks via theme contributions | Reach across to other plugins' state |
| Schedule background jobs via the event bus | Bypass the SDK and call core/engine directly |

### 8.5 Performance budget

Cross-worker RPC costs ~ms per call. The SDK is designed for this:

- Storage methods accept arrays (`getMany`, `putMany`) so plugins can batch.
- Hook payloads are passed by structured clone — large objects (full HTML, big media) are passed by handle, not by value.
- Listeners that don't need to transform a value should register as actions, not filters, so the host can fan out in parallel without serializing through them.

---

## 9. The public plugin/theme API — `@pressh/sdk`

`sdk` is the **only** package plugins import. Two entry points:

- **`@pressh/sdk`** — the worker entry. Everything plugins call.
- **`@pressh/sdk/host`** — host-side registration helpers. Used by core to declare what RPC ops exist; not for plugin authors.

The worker-side surface, sketched:

```ts
import {
  defineManifest,
  hooks,
  contentTypes,
  fields,
  endpoints,
  admin,
  storage,
  fetch,
  secrets,
  log,
} from '@pressh/sdk';

// All of these are proxies that RPC to the host.
// All are async.
```

Highlights:

- `storage.get`, `storage.list`, `storage.put`, `storage.delete` — capability-gated per collection.
- `fetch(url, init)` — proxied through host; host validates the target origin against `network.fetch:*` capabilities and adds outbound rate limits.
- `secrets.use(name, fn)` — host runs `fn` with a scoped handle; the plaintext secret never crosses into the worker unless the manifest explicitly requested it.
- `endpoints.define({ path, method, schema, handler })` — handler runs in the worker; the host's catch-all route handler dispatches inbound HTTP. The `schema` (Zod-style) is validated on the host before the worker is invoked, so bad input never reaches plugin code.
- `admin.panel({ path, title, entry })` — `entry` is a static HTML file inside the plugin folder; rendered in the studio iframe (see §11).
- `log.info/warn/error` — writes go through the host logger with the plugin id attached. Plugins cannot suppress logs.

The SDK is semver'd. The plugin manifest declares `sdkVersion: '^1.0.0'`; the host refuses to load plugins whose declared range doesn't intersect the running SDK.

---

## 10. Plugin lifecycle

Studio and site are separate processes (see §2). Each boots its own `PluginHost`, runs its own worker pool, and dispatches plugin requests through its own framework's HTTP layer. Plugins are loaded from the **same** `/plugins/` directory by both — there is one source of truth on disk, two runtime instantiations in memory.

### 10.1 Boot (both apps)

`PluginHost.boot()` runs once per process. It:

1. Scans `/plugins/*/pressh.plugin.ts` and parses each manifest.
2. Reads `pressh.signature.json` next to each plugin. **Verifies the signature** (publisher pubkey + content hash + Ed25519 signature). If the signature is missing or invalid, the plugin is refused unless its publisher is on the user-approved allowlist. Verified-publishers list is signed by the Pressh org key.
3. Semver-checks `sdkVersion` against the running SDK.
4. Topologically sorts plugins by `dependencies`; refuses cycles.
5. For each plugin: spawns a Node `worker_threads.Worker` with restricted module resolver, empty environment, and resource limits.
6. Awaits each worker's `__ready` handshake; marks unresponsive workers as `degraded` and continues.

`PluginHost.boot` does **not** `import()` plugin code in the host process. Plugin code only ever loads inside a worker.

### 10.2 Studio bootstrap (Vite + Hono)

```ts
// apps/studio/server.ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { PluginHost } from '@pressh/core';

const host = await PluginHost.boot({ pluginsDir, themesDir, sdkVersion: SDK_VERSION });

const app = new Hono();
app.route('/api',               adminApi(host));
app.route('/api/p/:plugin/*',   pluginRpc(host));     // see §10.4
app.route('/__plugin-ui/:plugin/*', pluginIframe(host)); // see §11
app.use('/*',                   serveSpa('./dist/spa'));

serve({ fetch: app.fetch, port: 3001 });
```

In dev, Vite handles the SPA via `npm run dev`; the Hono server runs separately on its own port via `npm run dev:server`. In prod, Vite builds the SPA to `dist/spa` and Hono serves it.

### 10.3 Site bootstrap (Next.js 16)

```ts
// apps/site/instrumentation.ts
import { PluginHost } from '@pressh/core';

export async function register() {
  const host = await PluginHost.boot({ pluginsDir, themesDir, sdkVersion: SDK_VERSION });
  globalThis.__pressh = { host };
}
```

### 10.4 Worker entry (both apps)

```ts
// @pressh/runtime/worker-entry.ts
import { parentPort, workerData } from 'node:worker_threads';
import { createSdkProxy } from '@pressh/sdk/internal';

const sdk = createSdkProxy(parentPort, workerData.capabilities);
const plugin = await import(workerData.entryPath);
await plugin.register(sdk);
parentPort.postMessage({ op: '__ready' });
```

### 10.5 Inbound HTTP dispatch

Plugin RPC endpoints are dispatched through a single catch-all route in each app:

- **Studio** (Hono): `app.all('/api/p/:plugin/*', handler)` — `handler` validates the request body against the plugin's declared schema, checks the actor's capability, posts to the plugin worker, awaits the response or timeout, returns the HTTP response.
- **Site** (Next.js): `app/api/p/[plugin]/[...action]/route.ts` — same logic, expressed as a Next Route Handler.

Server Actions are **not** used in either app. In the site, they cannot be dynamically registered (Next.js 16 encrypts action IDs at build time). In the studio, there are no Server Actions to begin with — it's a Vite SPA that calls the Hono API by `fetch`.

### 10.6 Public page rendering (site only)

```
app/[[...slug]]/page.tsx
   → engine.resolve(slug)
       → fires `router.resolve` filter (plugins can claim URL patterns via worker RPC)
       → loads record via StorageAdapter
       → renders blocks via active theme (with plugin component overrides via `block.component` filter)
```

### 10.7 Hot reload in dev

A `chokidar` watcher on `/plugins/*/` sends `SIGTERM` to the affected plugin's worker and respawns it with the new code. Core stays up; other plugins unaffected; sessions and in-flight requests survive. Dev only — in production, plugin reloads happen via the studio's plugin manager, generate audit entries, and use the same restart-this-worker mechanism.

### 10.8 Constraints carried from each framework

**Site (Next.js 16):**
- **Proxy** (formerly Middleware) is build-time static. Pressh ships one `proxy.ts` for core auth + tenancy. Plugins cannot add patterns.
- **Cache Components** is the v16 default. Plugin-served routes opt into dynamic rendering explicitly.
- **`serverExternalPackages`** keeps plugin npm deps out of the RSC bundler. The plugin installer manages this list; modifying it requires a server restart.

**Studio (Vite + Hono):**
- No file-based routing; all routes are programmatically declared on the Hono app. No fight with bundler assumptions.
- Vite's `import.meta.glob` is not used for plugins — plugins load inside workers, never the Vite graph.
- The Hono server's middleware order matters: capability gate runs before any plugin RPC; CSP headers applied to all iframe responses before they hit the wire.

---

## 11. Plugin admin UI — iframe-sandboxed

Plugin admin panels are **never** rendered in the studio's DOM. They render in iframes served from a Pressh studio route.

### 11.1 The iframe contract

- The studio's Hono server mounts `/__plugin-ui/:plugin/*`, which serves static files from the plugin folder.
- Response headers: `Content-Security-Policy` with strict default (only same-origin scripts + the plugin's declared external origins), `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` disabling powerful APIs.
- The iframe tag: `<iframe sandbox="allow-scripts allow-forms" src="...">`. The `sandbox` attribute means the iframe has a **new opaque origin**, so it cannot read studio cookies or `localStorage` even though the URL is same-origin.
- The studio passes a short-TTL, plugin-scoped, actor-scoped session token to the iframe via `postMessage` (never via URL or cookie).

### 11.2 The iframe SDK shim

A small JS file (`@pressh/runtime/iframe-shim`) the plugin's HTML includes:

```html
<script src="/__pressh/iframe-shim.js"></script>
<script>
  const pressh = await PresshIframe.connect();
  const posts = await pressh.storage.list('posts', { limit: 10 });
  pressh.ui.success('Done');
</script>
```

`PresshIframe.connect()` performs a handshake with the parent window, receives the session token, and exposes a Promise-based API. Under the hood every call is a `postMessage` to the studio, which forwards it through the plugin's worker (with capability check). **The iframe never has direct access to anything sensitive**, and a malicious or buggy plugin admin UI cannot:

- Read other plugins' admin panels (separate iframes, separate opaque origins).
- Read studio cookies or session storage (`sandbox` prevents it).
- Make network requests to undeclared origins (CSP blocks them).
- Read the admin user's session (only a scoped, capability-checked token, valid for this iframe only).

### 11.3 Why not in-tree React

In-tree React components give plugins full DOM access to the studio. A buggy plugin can read the admin's session via DOM, scrape other panels, or render fake login forms. Slack, Shopify, and Atlassian all converged on iframes for the same reason. The cost — plugin admin UI is less seamless visually — is real but acceptable; Pressh's `@pressh/ui-kit` ships CSS tokens and components plugins can reuse to keep the look consistent.

---

## 12. Hook taxonomy (first draft)

All hooks are **async** (the worker boundary requires it). A short anchor list; the rule is: don't ship a hook until a real plugin needs it.

### Actions

| Name | When | Receives |
|---|---|---|
| `boot.after` | after all plugins registered | host context |
| `content.beforeSave` | before record write | `{ type, record, actor }` |
| `content.saved` | after successful write | `{ type, record, prev, actor }` |
| `content.beforeDelete` | before deletion | `{ type, record, actor }` |
| `content.deleted` | after deletion | `{ type, record, actor }` |
| `content.beforeRender` | before page render | `{ record, request }` |
| `content.afterRender` | after page render | `{ record, htmlHash }` |
| `endpoint.before` | before plugin RPC dispatch | `{ plugin, action, actor }` |
| `endpoint.after` | after plugin RPC dispatch | `{ plugin, action, status }` |
| `auth.login.success` | after successful login | `{ actor }` |
| `auth.login.failure` | after failed login | `{ identifier, reason }` |

### Filters

| Name | Returns | Use |
|---|---|---|
| `query.where` | modified `WhereClause` | scoping, multi-tenant filters |
| `query.results` | modified `Record[]` | enrichment |
| `router.resolve` | `Resolution \| null` | claim a URL |
| `block.component` | block component ref | theme overrides |
| `field.value.in` | normalized value | input transforms |
| `field.value.out` | display value | output transforms |
| `auth.actor` | resolved actor | session enrichment |

---

## 13. Known unknowns

| # | Question | Why it matters |
|---|---|---|
| 1 | Concrete worker `resourceLimits` per plugin (RAM, CPU, RPC budget). | Too tight breaks legitimate plugins; too loose enables noisy-neighbor abuse. Needs measurement once real plugins exist. |
| 2 | Ed25519 vs Sigstore for plugin signature primitive. | Bundled signature shape is decided (§10.1); the cryptographic primitive is not. Sigstore gives free transparency log; Ed25519 has zero infra. |
| 3 | Auth providers — which ship in v1 box? (local password is the only certainty.) | Affects v1 scope and the "you can deploy this Friday" story. |
| 4 | Theme system formal contract — what does a `Theme` package's package.json declare? | Theme switching and the block.component filter shape depend on this. |
| 5 | Plugin upgrade path when an in-use content type schema changes. | Will break sites if mishandled; needs a migration framework before too many plugins ship. |

---

## 14. Glossary

- **Core** — `@pressh/core`. Plugin host, hook bus, secrets vault, audit log, auth, permissions, storage interface. No HTTP, no UI.
- **Engine** — `@pressh/engine`. Content runtime: types, fields, queries, render, media, revisions.
- **SDK** — `@pressh/sdk`. Versioned public API. Worker-side entry for plugins; host-side entry for internal registration.
- **Plugin** — a folder under `/plugins/<name>/` with a `pressh.plugin.ts` manifest. Runs in a Node worker thread, never in the host process.
- **Worker** — a Node `worker_threads` instance hosting one plugin. Communicates with host only via structured-clone RPC.
- **Capability** — a string permission like `storage.write:posts`. Manifests declare needs; users approve at install; the host enforces at every RPC.
- **Theme** — a React component package mapping block IDs to renderers. Activated via studio.
- **Content type** — a named schema of fields with lifecycle rules.
- **Block** — a serializable chunk of content rendered by the theme.
- **Hook** — a named extension point. Async by definition. Actions are fire-and-observe; filters transform a value.
- **Endpoint** — a plugin-defined RPC route dispatched through a catch-all Route Handler.
- **Adapter** — a `StorageAdapter` implementation. Not Next.js's build-time `adapters/` API.
- **Studio** — admin app. Vite SPA + Hono server.
- **Site** — public-facing app. Next.js 16 with SSR.
- **Job** — a unit of deferred or scheduled work submitted to `core.jobs`; dispatched as a plugin RPC call after the run-at time.
- **Signature** — `pressh.signature.json` bundled in a plugin folder; publisher pubkey + content hash + Ed25519/Sigstore signature. Verified at boot.
- **Audit log** — append-only, hash-chained record of mutations, capability uses, logins.
- **Sensitive field** — field marked `sensitive: true`. Encrypted at rest, redacted in logs, gated by a separate capability.

---

## Appendix A — Decisions log

| Date | Decision | Status |
|---|---|---|
| 2026-05-19 | Three-layer monorepo: core / engine / apps + sdk + ui-kit + runtime. | [DECIDED] |
| 2026-05-19 | Runtime drop-in plugins (WordPress UX) via worker_threads isolation, loaded at server start from each app's server entry. | [DECIDED] |
| 2026-05-19 | All plugins isolated uniformly — no privileged/trusted tier. | [DECIDED] |
| 2026-05-19 | Plugin admin UI rendered in sandboxed iframes, never in the studio's DOM. | [DECIDED] |
| 2026-05-19 | Capability-gated plugin RPC, default deny, declared in manifest, approved by user at install. | [DECIDED] |
| 2026-05-19 | 14 secure-by-default baselines (§7) locked into core; not configurable in v1. | [DECIDED] |
| 2026-05-19 | File-based storage by default; DB connectors via `StorageAdapter` interface. No raw query access without explicit capability. | [DECIDED] |
| 2026-05-19 | Plugin endpoints (RPC over catch-all Route Handler), not Server Actions. | [DECIDED] |
| 2026-05-19 | Site uses Next.js's sanctioned extension points (no custom Node server). Studio uses a custom Hono server because it's a Vite SPA — different shape, different rules. | [DECIDED] |
| 2026-05-19 | All hooks are async (the worker boundary makes sync impossible). | [DECIDED] |
| 2026-05-19 | Hybrid framework: studio is a Vite SPA + Hono server (React 19); site is Next.js 16 SSR. Each process has its own `PluginHost`. | [DECIDED] |
| 2026-05-19 | Studio and site run as **two separate Next/Node processes**, not one app. Blast-radius isolation between admin and public surface. | [DECIDED] |
| 2026-05-19 | i18n: per-locale records joined by `contentId`, BCP 47 locale codes, fallback chains at query time. | [DECIDED] |
| 2026-05-19 | FS adapter indexing: SQLite sidecar (`.pressh-index.db`) next to the content tree. In-memory mirror deferred. | [DECIDED] |
| 2026-05-19 | Hot reload in dev: per-worker SIGTERM + respawn via chokidar watch. Core stays up. | [DECIDED] |
| 2026-05-19 | Background jobs: own scheduler in core, persisted, capability-gated, dispatched as deferred plugin RPC. `JobBackend` interface allows external queue adapters later. | [DECIDED] |
| 2026-05-19 | Plugin signing: `pressh.signature.json` bundled in plugin folder (publisher pubkey + content hash + signature). No central registry in v1. Pressh org maintains a verified-publishers allowlist. | [DECIDED] |
| 2026-05-19 | Secrets vault: `SecretsBackend` interface with file-based AES-256-GCM default keyed by `PRESSH_MASTER_KEY`. KMS / Vault adapters out of scope for v1. | [DECIDED] |
