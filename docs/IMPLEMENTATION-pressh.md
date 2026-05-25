# Implementation Guide — Pressh

**Status:** Approved · **Date:** 2026-05-20
**Purpose:** A dependency-ordered, agent-executable build plan. Each phase is sized to be completed end-to-end in one focused session with an explicit **acceptance gate**. Build phases **in order** — each assumes the prior phases are green. Do not start a phase until its dependencies' acceptance gates pass.

---

## How to use this guide
- One phase = one branch = one PR. Mark a phase done **only** when its acceptance tests pass.
- **Definition of Done (every phase):** code + unit/integration tests written; `npm run build` + `npm test` green; typecheck + lint clean; no secrets committed; public/admin boundary and capability checks honored where relevant.
- **Security invariants that hold in every phase** (never violate, even temporarily): plugins run only in workers; the host never imports plugin code; capability checks are server-side; CSRF on mutations; UUID IDs; published-only public scope; secrets only via the vault; mutations write an audit entry.
- Versions are pinned in TDD Appendix B. Use them exactly.

---

## Target repository layout
```
pressh/
├─ package.json                # npm workspaces root
├─ tsconfig.base.json
├─ tsconfig.json               # solution refs (tsc -b)
├─ vitest.config.ts            # aliases @pressh/* → src
├─ docker-compose.yml
├─ packages/
│  ├─ core/        # auth, caps, vault, audit, hooks, config, scheduler, storage iface
│  ├─ engine/      # content types, entries, revisions, blocks, query, i18n, media, render, gdpr
│  ├─ sdk/         # worker/ host/ internal/ — the plugin-facing API
│  ├─ runtime/     # worker-entry runner + iframe shim
│  └─ ui-kit/      # shared React 19 components + tokens
├─ adapters/
│  ├─ postgres/  ├─ sqlite/  └─ mongo/    # StorageAdapter impls
├─ apps/
│  ├─ studio/    # Vite SPA + Hono (admin)
│  └─ site/      # Hono + Vite SSR (public)
├─ plugins/      # installed plugin bundles (incl. example plugin)
├─ themes/       # curated themes
└─ content/      # filesystem content store (default)
```
**Build rule:** packages publish from `dist/` (their `package.json` `exports` point at `./dist/*.js`); run `npm run build:packages` (`tsc -b`) before running an app server. `vitest.config.ts` aliases `@pressh/*` → `src/*` so tests run against live source.

---

## Phase 0 — Monorepo & tooling skeleton  · Effort S · Depends: —
**Goal:** A buildable, testable empty workspace.
**Files:** root `package.json` (workspaces: `packages/*`, `adapters/*`, `apps/*`), `tsconfig.base.json`, `tsconfig.json` (project refs), `vitest.config.ts`, `eslint.config.mjs`, empty package skeletons with `src/index.ts` + `package.json` (`exports`→`dist`) + `tsconfig.json`.
**Steps:**
1. Init npm workspaces; add scripts: `build:packages` (`tsc -b`), `build` (packages→studio→site), `test` (vitest), `lint`, `typecheck`.
2. Configure `tsconfig.base.json` (strict, `moduleResolution: nodenext`, composite).
3. `vitest.config.ts`: alias every `@pressh/*` to its `src`.
4. CI workflow: typecheck → lint → test → build.
**Acceptance:** `npm run build` and `npm test` succeed on empty packages; CI green.

## Phase 1 — `@pressh/core`: kernel primitives  · Effort M · Depends: 0
**Goal:** Foundational primitives every later phase imports.
**Key interfaces/types:**
```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: PressError };
interface HookBus { on(hook: string, fn: AsyncHook): void; emit(hook: string, ctx: unknown): Promise<void>; }
interface CapabilityGate { check(granted: string[], required: string): boolean; }
interface Logger { info/warn/error/debug(msg, fields?): void; } // pino, redacts `sensitive`
interface Config { get<T>(key: string): T; }
```
**Steps:** implement async `HookBus`; capability string parser + matcher (supports `ns.action:scope` and wildcards); pino logger with redaction; config loader (env + `pressh.config.ts`); typed error model.
**Acceptance:** unit tests — hook ordering/async, capability match/deny (incl. scope + wildcard), logger redaction of `sensitive` keys.

## Phase 2 — Storage interface + FS adapter + SQLite index  · Effort M · Depends: 1
**Goal:** Canonical filesystem store with a fast query index.
**Key interface:**
```ts
interface StorageAdapter {
  get(collection: string, id: string): Promise<Result<Record|null>>;
  put(collection: string, id: string, doc: Record): Promise<Result<void>>;
  delete(collection: string, id: string): Promise<Result<void>>;
  query(collection: string, filter: Filter, page: Cursor): Promise<Result<Page>>;
  transaction(fn): Promise<Result<void>>;
  raw?(...): Promise<unknown>;          // gated by storage.raw capability
}
```
**Steps:** FS adapter (one file per record under `/content/<collection>/<id>.json`); better-sqlite3 index mirroring queryable fields; index rebuild from files (idempotent, checksum on boot); migrations runner.
**Acceptance:** CRUD round-trip; `query` returns indexed results with cursor pagination; delete the index and rebuild → identical results.

## Phase 3 — Secrets vault + audit log  · Effort M · Depends: 1, 2
**Goal:** Sealed secrets + tamper-evident audit trail.
**Key interfaces:**
```ts
interface SecretsBackend { setSecret(name, value): Promise<void>; getSecret(name): Promise<string>; rotate(newKey): Promise<void>; }
interface AuditLog { append(e: { action; actorId; detail }): Promise<void>; verifyChain(): Promise<boolean>; query(f): Promise<AuditEntry[]>; }
```
**Steps:** AES-256-GCM file backend keyed by `PRESSH_MASTER_KEY` (fail-closed if absent/bad); append-only audit writer where `hash = H(prevHash + entry)`; redact `sensitive` in detail.
**Acceptance:** encrypt→decrypt round-trip; rotate re-encrypts and old key fails; `verifyChain()` true normally, false after tampering a record; audit append on a sample mutation.

## Phase 4 — Auth & RBAC core  · Effort L · Depends: 1, 2, 3
**Goal:** Identity, sessions, roles→capabilities, anti-brute-force, CSRF.
**Steps:** users (argon2id); sessions (httpOnly/Secure/SameSite cookie, rotate on login, revoke); roles seed (Owner/Admin/Editor/Author/Viewer) → capability sets; rate-limit + lockout; CSRF token issue/verify (centralized — to be enforced by SDK/middleware later); optional TOTP MFA scaffolding.
**Acceptance:** login/logout; uniform error on bad creds (no enumeration); role→capability resolution; lockout after N failures + audit; CSRF verify rejects missing/invalid token.

## Phase 5 — `@pressh/engine`: content model  · Effort L · Depends: 2, 4
**Goal:** Content types, entries, revisions, workflow, i18n.
**Key types:**
```ts
interface ContentType { id: uuid; name; slug; fields: Field[]; }
interface Field { id; type: FieldType; name; required: boolean; validation?: ZodJson; sensitive?: boolean; }
type Status = 'draft'|'in_review'|'scheduled'|'published'|'archived';
interface ContentEntry { id: uuid; typeId: uuid; slug; status: Status; authorId: uuid; locale; publishedAt?; currentRevision: number; }
interface Revision { id: uuid; entryId: uuid; version: number; blocks: BlockNode[]; editorId: uuid; createdAt; }
```
**Steps:** Zod schema generated from `Field[]`; CRUD with capability checks + audit; revision-on-save; state machine transitions (capability-gated; see TDD §state machine); per-locale variants.
**Acceptance:** define a type → create/edit/publish an entry; each save creates a revision; illegal transitions denied; restore an old revision creates a new revision; create + publish a locale variant independently.

## Phase 6 — Block system & sanitization  · Effort M · Depends: 5
**Goal:** Safe, typed page content.
**Steps:** block schema + registry; per-block sanitizer (allowlist HTML/attrs); raw-HTML block requires `content.rawhtml` capability; unknown/disabled block → safe fallback at render.
**Acceptance:** XSS payload corpus stripped (`<script>`, `onerror=`, `javascript:` URLs, etc.); raw-HTML block without capability is rejected; disabled block renders fallback, not raw content.

## Phase 7 — Query resolver + URL resolution  · Effort M · Depends: 5, 6
**Goal:** Resolve a public URL/slug to renderable content, safely scoped.
**Steps:** `QueryResolver.resolve(url, locale)` → entry + blocks; **published-only** scope for public callers; admin scope by capability; UUID IDs; no user-identifying fields in public results.
**Acceptance:** resolve a slug to its published entry; drafts invisible to public scope; requesting a non-existent or unauthorized resource returns 404 uniformly (no enumeration).

## Phase 8 — `@pressh/sdk` + `@pressh/runtime`: plugin host  · Effort XL · Depends: 1, 3, 4
**Goal:** The security heart — isolated, capability-gated plugins.
**Key pieces:**
```ts
// host side
interface PluginHost { load(dir): Promise<void>; call(plugin, method, args): Promise<Result<unknown>>; endpoints(): EndpointManifest; stop(plugin): void; }
// worker side (sdk/worker): proxy turns calls into postMessage RPC
// manifest
interface PluginManifest { name; version; capabilities: string[]; endpoints: { method; path; handler }[]; }
```
**Steps:**
1. `runtime/worker-entry`: loads a plugin in a `worker_threads.Worker`, wires `parentPort` RPC.
2. `sdk/worker`: typed proxy (storage/media/network/secrets-by-name/hooks/endpoints) → RPC; **no** other host channel.
3. PluginHost: discover `/plugins`, verify `pressh.signature.json` (prod required; dev allows unsigned or `PRESSH_ALLOW_UNSIGNED=1`), one worker per plugin, **capability gate before every dispatch**, expose endpoint manifest.
4. Worker resource caps: timeout, memory limit → kill+restart on breach.
**Acceptance:** load the example plugin in a **real** worker; call a method over RPC and get a real result; a call requiring an ungranted capability is **denied** and audited; an unsigned plugin is **rejected** under `NODE_ENV=production`; a worker that hangs is killed and restarted; plugin cannot read host globals / other plugins / raw env.

## Phase 9 — `apps/site`: Hono + Vite SSR  · Effort XL · Depends: 5, 6, 7, 8
**Goal:** The public site with WordPress-like runtime dynamism.
**Steps:**
1. Hono server; **front controller**: catch-all route → `QueryResolver.resolve` → Vite SSR render → HTML.
2. **API dispatcher**: catch-all `ANY /api/p/:plugin/:action` → PluginHost RPC (capability-checked).
3. Tag-cache: cache rendered responses by content tag; `revalidateTag` on publish (cross-process invalidation per ADR-002/012); personalized responses bypass.
4. SEO: `sitemap.xml`, `robots.txt`, meta/canonical, structured-data hooks.
5. Security headers: strict CSP (declared origins), HSTS; image-optimization route; TLS enforced in prod.
**Acceptance:** publish content → its URL renders **server-side** on next request with **no rebuild**; install+approve example plugin → `POST /api/p/example/...` answers; editing+publishing invalidates exactly the affected page; SSR HTML contains content without client JS; sitemap lists published content; CSP present.

## Phase 10 — `apps/studio`: Vite SPA + Hono (no-code authoring)  · Effort XL · Depends: 4, 5, 6, 7
**Goal:** The full no-code admin experience.
**Steps:** Hono serves the Vite-built React SPA + admin API (session+CSRF+capability middleware); screens: auth, dashboard, **content-type builder** (no-code modeling), **drag-drop block page editor**, **media library** (upload validation: magic-byte + content-type + extension whitelist, stored outside web root), **menu builder**, **form builder**; seed CLI to bootstrap the first admin.
**Acceptance:** end-to-end no-code flow with **no code change**: model a new content type → build a page with blocks → upload media (a disguised executable is rejected) → publish → see it live on the Site. Capability checks enforced server-side (an Author cannot publish via the API even if the UI allowed it).

## Phase 11 — Theming  · Effort L · Depends: 9, 10
**Goal:** Curated themes + visual customizer.
**Steps:** theme package format (TS-authored components + token schema); one curated default theme; visual customizer (color/font/spacing/layout tokens) with iframe-sandboxed live preview; apply tokens to Site on publish.
**Acceptance:** switch theme; adjust tokens with live preview in a sandboxed iframe; publish → tokens apply to the public site; no raw template/CSS editing required of the user.

## Phase 12 — Plugin admin UI (iframe)  · Effort M · Depends: 8, 10
**Goal:** Safe plugin-contributed admin panels.
**Steps:** serve plugin panels from a Studio route in `<iframe sandbox="allow-scripts allow-forms">` with strict CSP; postMessage bridge (typed protocol) between panel and Studio.
**Acceptance:** example plugin renders an admin panel in a sandboxed iframe and communicates via postMessage; the panel **cannot** read Studio cookies/session or access Studio's DOM.

## Phase 13 — GDPR features  · Effort L · Depends: 3, 4, 5
**Goal:** First-class data-subject rights.
**Key interface:**
```ts
interface GdprService {
  export(subjectRef): Promise<JsonExport>;        // Art. 15/20
  erase(subjectRef): Promise<{ tombstoneId }>;     // Art. 17 — cascade + crypto-shred + audit
  recordConsent(subjectRef, scope, granted): Promise<void>;  // Art. 6/7
  applyRetention(): Promise<void>;                 // Art. 5(1e) — scheduled purge
}
```
**Steps:** entities declare subject linkage + sensitivity; export gathers all keyed records; erase cascades across stores, crypto-shreds sensitive fields (destroy key), writes audited tombstone preserving referential integrity; consent manager + cookie banner; retention policies → purge job; ensure `sensitive` fields are redacted in logs.
**Acceptance:** export returns all of a subject's data as valid JSON; erase makes personal data unrecoverable, leaves an audit entry + tombstone; a later export shows nothing for that subject; sensitive fields never appear in logs.

## Phase 14 — Background jobs scheduler  · Effort M · Depends: 1, 3
**Goal:** Persisted, capability-gated jobs.
**Steps:** persisted job queue in core; job types: scheduled publish, cache warm, backup, CVE sync; idempotent handlers; catch-up after downtime.
**Acceptance:** schedule a future publish → it fires at its time; stop+restart the process → pending job still runs (catch-up); re-running a job is idempotent.

## Phase 15 — Plugin CVE feed + signing pipeline  · Effort M · Depends: 8, 14
**Goal:** Supply-chain defense.
**Steps:** signature verification (`pressh.signature.json`); CVE feed sync job; host refuses to load flagged plugins; surface status in Studio.
**Acceptance:** a validly signed plugin loads; a plugin flagged by the CVE feed is refused; tampered signature is rejected; stale feed warns but degrades gracefully.

## Phase 16 — Storage adapters (Postgres / SQLite / Mongo)  · Effort L · Depends: 2
**Goal:** Scale beyond the FS default.
**Steps:** implement `StorageAdapter` for each backend (parameterized queries; no string-built SQL); FS→DB migration tool; config-driven backend selection.
**Acceptance:** the Phase-2 + content integration suites pass **unchanged** against each adapter; migrate an FS install to Postgres with all content + revisions intact.

## Phase 17 — Observability + ops  · Effort L · Depends: 9, 10
**Goal:** Operable, deployable, recoverable.
**Steps:** pino structured logs (redacted) + correlation IDs; OpenTelemetry traces (HTTP→engine→worker); Prometheus metrics; `/healthz` + `/readyz`; Dockerfiles + `docker-compose.yml`; `pressh` CLI: `seed`, `migrate`, `index:rebuild`, `backup`, `restore`, `vault:rotate`, `gdpr:export|erase|purge`.
**Acceptance:** `docker compose up` yields a working two-process install; metrics + traces emit; backup→restore on a fresh host yields an identical working install.

## Phase 18 — Hardening + production readiness  · Effort L · Depends: all
**Goal:** Ship 1.0.
**Steps:** enforce TLS + full security-header set; CI dependency + secret + SAST scanning (fail on high/critical); SBOM; Playwright e2e (auth, authz, no-code golden path, GDPR); load test to the capacity targets; sanitizer fuzzing; finalize docs; external pentest.
**Acceptance:** security checklist (all 14 baselines verifiable by test); e2e golden path green; load test meets NFR-PERF targets; pentest issues triaged/closed.

---

## Wave 2 — Commerce (Inventory plugin → store)

> Built 2026-05-25 against the v1 platform; all four phases **done** (440 tests green, 0 lint errors, production build
> clean). Satisfies SRS FR-025, FR-060…FR-066 and ADR-013/014. Delivered phase-gated.

## Phase 19 — Advanced catalog (Inventory backend + admin)  · Effort L · Depends: 8, 10 · Status: done

**Goal:** Turn the basic inventory plugin into a full product catalog.
**Steps:** model products with option axes + variants (per-variant SKU/price/stock), categories (with child
re-parenting), an audited stock ledger (`receive`/`adjust`/`set`/`sell`/`return`/`correction`, negative guard, low-stock
thresholds), images/tags/slug/SEO/compare-at price, and store settings — all in plugin-owned collections. Rebuild
`panel.html` as a tabbed admin (Products with a variant matrix, Categories, Stock, Settings).
**Acceptance:** unit tests for variants, ledger reconciliation, low-stock flagging, categories, settings; legacy `save`/
`publicItems` exports preserved; plugin re-signed.

## Phase 20 — Orders / returns / payments · Effort L · Depends: 19 · Status: done

**Goal:** Full order lifecycle with recorded payments and returns.
**Steps:** `createOrder` (server-authoritative pricing + stock validation + ledger decrement, tax/shipping/discount);
order status lifecycle + fulfil/cancel-with-restock; recorded payments + refunds behind a `PaymentGateway` seam (
`manual` only) with a derived payment status and over-refund guard; returns (validated against order lines,
`processReturn` restocks + refunds up to amount paid); dashboard summary; serialized order/return numbering. Add
Dashboard/Orders/Returns/Payments admin tabs.
**Acceptance:** tests for totals, stock decrement, oversell rejection, cancel-restock, return refund+restock, refund
guard, dashboard.

## Phase 21 — Plugin→designer widgets + commerce primitives · Effort M · Depends: 11, 19 · Status: done

**Steps:** add an optional `designerPresets` manifest field; PluginHost loads + sanitizes presets and exposes
`designerPresets()` for **enabled** plugins only; studio designer-library endpoint merges them. Add generic engine
primitives `addToCart` + `commerce` (CSP-safe `data-ps-*`, not in the base palette) and a `collectionList` `source`
prop. Ship `builtins/inventory/presets.json` (Product Grid, Featured, Cart Button, Cart, Checkout, Add-to-Cart).
**Acceptance:** engine render tests for the new primitives + source pass-through; host test proves presets appear only
while enabled; studio library merges them.

## Phase 22 — Storefront runtime · Effort M · Depends: 9, 20, 21 · Status: done

**Steps:** Site `makeSiteContext` resolves `collectionList source="<plugin>:<resource>"` via
`pluginHost.invoke(plugin,"feed",…)` when enabled; add public POST endpoints `/products`, `/cart` (cartPreview),
`/checkout`; build a CSP-safe storefront client (`apps/site/src/client/storefront.ts` + `storefront.css`) — localStorage
cart, live mini-cart count, cart + checkout widgets that place real orders, styling via a bundled same-origin
stylesheet (no inline style/script).
**Acceptance:** site integration test renders products from an enabled plugin and shows the empty state when disabled;
plugin tests for cartPreview (over-order/missing flags) and checkout (order created, stock decremented); client bundles
clean.

---

## Cross-cutting test matrix (must stay green from the phase that introduces each)
| Area               | Test                                                                         | From phase |
|--------------------|------------------------------------------------------------------------------|------------|
| Capability denial  | every capability has a deny test                                             | 8          |
| Worker escape      | host globals / other plugins / raw env inaccessible                          | 8          |
| XSS                | sanitizer strips payload corpus                                              | 6          |
| Upload             | polyglot/disguised exec rejected                                             | 10         |
| Enumeration        | uniform 401/404; no user data public                                         | 7, 9       |
| CSRF               | mutation without token rejected                                              | 4, 10      |
| Audit              | mutation appends entry; chain verifies                                       | 3          |
| GDPR               | export complete; erase unrecoverable + audited                               | 13         |
| Cache              | publish invalidates exactly affected pages                                   | 9          |
| Adapters           | same suite passes on FS/PG/SQLite/Mongo                                      | 16         |
| Commerce integrity | client can't set price/oversell; stock ledger reconciles; refund ≤ collected | 20, 22     |
| Plugin widgets     | presets surface only while enabled; ids namespaced; render is no-inline      | 21         |

## Suggested branch / PR naming
`phaseNN-short-name` (e.g., `phase08-plugin-host`). One PR per phase; PR description links the phase's acceptance gate and the relevant SRS FR/NFR IDs.

## What to defer (do not build in MVP)
Multi-tenant SaaS; hosted plugin marketplace/registry; real-time collaborative editing; multi-region active-active. These would change the trust model or scope — revisit at the appropriate wave (see SDR roadmap).
