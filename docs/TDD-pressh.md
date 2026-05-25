# Technical Design Document — Pressh v1.0

**Status:** Approved · **Date:** 2026-05-20
**Approved architecture:** Option A — Two-Process Trust-Split (Hono + Vite SSR)

---

## 1. Executive Summary
Pressh is a self-hosted, no-code CMS in TypeScript whose reason to exist is security: it eliminates WordPress's data-leakage failure modes by running all plugins in isolated worker threads behind a default-deny capability gate, never executing third-party code in the render tree, and baking security into the core SDK. The system runs as two independent processes — **Studio** (admin SPA + Hono) and **Site** (public, Hono + Vite SSR) — sharing on-disk content/plugins but never process memory. A WordPress-style **front controller** resolves any URL or plugin endpoint at request time, so new content types, pages, and plugin endpoints are live with zero rebuild. Storage is filesystem-by-default with a SQLite index, swappable to Postgres/SQLite/Mongo via a single adapter interface. GDPR data-subject rights are first-class engine features.

## 2. Architecture Overview

### 2.1 Architecture Style & Rationale
A **modular monorepo** of framework-agnostic packages consumed by two **process-isolated** apps. Style drivers:
- *Security as primary quality attribute* → uniform worker isolation, capability gating, process split (admin vs public trust boundary).
- *Runtime extensibility like WordPress* → front-controller pattern (data-driven routing) instead of file/build-time routing.
- *Self-hosted simplicity* → file-default storage, single Docker host viable, no cloud lock-in.

### 2.2 System Context
Actors: Visitor, Editor/Author, Admin/Owner, Plugin Developer, Data Subject. External systems: reverse proxy/CDN, SMTP, optional DB, optional object store, plugin CVE feed. (See architecture-pressh-v1.html → Diagrams for C4 context/container, sequences, ER, deployment.)

### 2.3 Key Design Principles
1. **Default deny.** No capability is granted implicitly; every cross-boundary call is checked.
2. **Plugins are untrusted, uniformly.** No privileged tier; the host never imports plugin code.
3. **Security in the core, not in plugin discipline.** CSRF, sanitization, UUIDs, capability checks live in `core`/`sdk` so authors can't forget them.
4. **State in storage, not memory.** Processes are restartable and horizontally scalable.
5. **Data-driven routing.** URLs and endpoints resolve from storage at request time.
6. **Framework-agnostic core.** Nothing security-relevant lives in `apps/*`.

## 3. Architecture Decision Records (summary)
Full records in ADRs-pressh.md. Summary:
- **ADR-001** Unified Hono + Vite SSR; drop Next.js.
- **ADR-002** Two-process trust split (Studio vs Site).
- **ADR-003** Uniform worker-thread plugin isolation (no trusted tier).
- **ADR-004** Default-deny capability model, checked on every RPC.
- **ADR-005** Iframe-sandboxed plugin admin UI.
- **ADR-006** Filesystem-default storage + SQLite index, adapter interface for DBs.
- **ADR-007** Front-controller (catch-all) routing for runtime extensibility.
- **ADR-008** GDPR data-subject rights as core engine features.
- **ADR-009** Sealed AES-256-GCM secrets vault; scoped tokens to plugins.
- **ADR-010** Append-only hash-chained audit log.
- **ADR-011** Plugin signing + CVE gate.
- **ADR-012** Content-tag caching with on-publish invalidation.

## 4. Component Design

### 4.1 `@pressh/core` (kernel)
- **Responsibility:** auth, RBAC/capabilities, secrets vault, audit log, hook bus (async), config, logging, job scheduler, storage interface.
- **Tech:** TypeScript, Node 24, argon2, AES-256-GCM (Node crypto), pino, Zod.
- **Interfaces (out):** `Auth`, `CapabilityGate`, `SecretsBackend`, `AuditLog`, `HookBus`, `StorageAdapter`, `Scheduler`.
- **Failure modes:** vault decrypt failure → fail-closed boot; audit write failure → reject mutation (fail-closed).
- **Scaling:** in-process library; stateless except storage.

### 4.2 `@pressh/engine` (content runtime)

- **Responsibility:** content types/fields, content entries, revisions, block system + sanitization, query resolver,
  i18n, media, render pipeline, cache-tag registry, GDPR data-subject operations, the **primitive page model** (
  designer).
- **Interfaces (out):** `ContentService`, `BlockRegistry`, `QueryResolver`, `MediaService`, `RenderService`, `GdprService`.
- **Primitive page model (`primitives/`):** the designer renders a tree of type-validated primitives — every style value
  is checked against a per-property grammar and **no inline `style`/`on*` attribute is ever emitted**, so output
  satisfies the Site's hashed `style-src` CSP. Data primitive `collectionList` takes an optional `source` (
  `"<plugin>:<resource>"`) that the host's `PrimitiveRenderContext` resolves to a plugin feed; commerce primitives
  `addToCart` (emits CSP-safe `data-ps-add`) and `commerce` (`view: cart|cartButton|checkout`) exist for
  plugin-contributed presets and are intentionally **not** in the base palette.
- **Failure modes:** sanitization failure → drop block, log; render error in a block → fallback placeholder; an unknown
  primitive type renders inert.
- **Scaling:** pure functions over storage; cache memoizes render output per revision.

### 4.3 `@pressh/sdk` (plugin surface)
- **Responsibility:** the only API plugins import. Subpackages: `worker` (proxy that turns calls into RPC), `host` (host-side registration/types), `internal` (shared types). Bundles CSRF, capability requests, sanitization helpers so authors can't bypass them.
- **Interfaces:** typed proxies for storage, media, network (declared origins), secrets-by-name, hooks, endpoint
  registration. The `PluginManifest` also declares `panelActions` (the panel-invocable allowlist) and an optional
  `designerPresets` (a presets JSON file the plugin contributes to the designer palette).

### 4.4 `@pressh/runtime` (worker + iframe)
- **Responsibility:** worker entry runner (loads plugin in worker, wires `parentPort` RPC), iframe shim for plugin admin panels.
- **Failure modes:** worker crash/timeout/OOM → host kills + restarts; request fails closed.

### 4.5 `@pressh/ui-kit`
- **Responsibility:** shared React 19 components/design tokens for Studio and themes; accessible primitives.

### 4.6 PluginHost (in each app process)

- **Responsibility:** discover `/plugins`, verify signature (prod), instantiate one worker per plugin, route RPC,
  enforce capability gate before dispatch, expose endpoint manifest to the dispatcher, load+sanitize contributed
  designer presets.
- **Design notes:** one worker per plugin for fault isolation; structured-clone messages; capability check is host-side
  and authoritative. `designerPresets()` returns contributed presets **only for enabled plugins** (ids namespaced
  `plugin:id`, shape-validated/size-capped at load); a disabled plugin contributes neither endpoints nor presets.

### 4.7 `apps/site` (public)
- **Responsibility:** Hono server; **front controller** (catch-all → `QueryResolver`), **API dispatcher** (catch-all `/api/*` → PluginHost), Vite SSR render, tag-cache + revalidation, sitemap/robots, image route, strict CSP headers.

### 4.8 `apps/studio` (admin)

- **Responsibility:** Hono server serving the Vite-built React SPA; admin API + RPC; iframe-served plugin panels; seed
  CLI (admin bootstrap); the designer-library endpoint (`/admin/api/designer/library`) merges built-in presets with *
  *enabled-plugin** presets. Deployable behind allowlist.

### 4.9 `adapters/*`
- **Responsibility:** `StorageAdapter` implementations for Postgres / SQLite / Mongo; migration from FS default.

### 4.10 `builtins/*` (first-party plugins)

- **Responsibility:** signed first-party plugins shipped in `builtins/` (DB, Inventory/Store, Forms, SEO, Analytics) —
  same worker isolation + capability model as any plugin; all ship disabled.
- **Inventory/Store:** a full commerce backend over plugin-owned collections — catalog (option axes + variants),
  categories, audited stock ledger, orders, recorded payments (pluggable `PaymentGateway` seam; `manual` only in v1),
  returns, and a dashboard. Ships a tabbed admin panel, public storefront endpoints (`feed`/`cartPreview`/`checkout`),
  and contributed designer presets (Product Grid, Cart, Checkout, …). Order/return numbers via a serialized counter; the
  stock ledger uses a monotonic `seq` tiebreaker.

## 5. Data Design

### 5.1 Data Models
Canonical store is the filesystem (content as structured files), indexed by SQLite for queries; DB adapters mirror the same logical schema. Core entities and key fields (full list in SRS Appendix B):

```
ContentType { id:uuid, name, slug, fields:Field[], createdAt }
Field       { id, type:enum, name, required:bool, validation:json, sensitive:bool }
ContentEntry{ id:uuid, typeId:uuid→ContentType, slug, status:enum, authorId:uuid→User,
              locale, publishedAt?, currentRevision:int }   index(slug,locale,status)
Revision    { id:uuid, entryId:uuid→ContentEntry, version:int, blocks:json, editorId:uuid, createdAt }
User        { id:uuid, email:unique, passwordHash, mfaEnabled:bool, status:enum, createdAt }
Role        { id, name, capabilities:string[] }   UserRole(userId,roleId)
Media       { id:uuid, filename, mime, size, checksum, path, createdAt }   path OUTSIDE web root
Menu/MenuItem, Form/FormSubmission, ConsentRecord
Plugin      { id, name, version, capabilities:string[], signatureOk:bool, enabled:bool }
Secret      { name:pk, ciphertext, scope, createdAt }      AES-256-GCM
AuditEntry  { id:uuid, action, actorId, detail:json, prevHash, hash, at }  append-only chain
Session     { id:uuid, userId, expiresAt, revoked:bool }
```
- **IDs:** UUID v4 everywhere (baseline #1; prevents IDOR).
- **Indexes:** `(slug,locale,status)` on entries; `(entryId,version)` on revisions; `email` unique on users; `at` on audit.

**Commerce (Inventory plugin) — plugin-owned, capability-gated collections (never `content_entries`):**

```
Product   (inventory_items)            { id:uuid, name, slug, sku, price, compareAtPrice?, currency,
                                          categoryId?, tags[], images[], options[], variants[],
                                          lowStockThreshold, seoTitle?, seoDescription?, published,
                                          totalStock, inStock, lowStock }   // last 3 are denormalised roll-ups
Variant   (embedded in Product)        { id:uuid, optionValues{}, label, sku, price?, stock, lowStockThreshold? }
Category  (inventory_categories)       { id:uuid, name, slug, description?, parentId? }
Movement  (inventory_stock_movements)  { id:uuid, itemId, variantId, type, qtyDelta, balanceAfter, reason?, ref?, at, seq }
Order     (inventory_orders)           { id:uuid, number:int, status, lines[], subtotal, tax, shipping,
                                          discount, total, currency, customer{}, paymentStatus,
                                          amountPaid, amountRefunded, source, restocked }
Payment   (inventory_payments)         { id:uuid, orderId, kind:'payment'|'refund', amount, method, status,
                                          gateway, gatewayRef?, note?, at, seq }
Return    (inventory_returns)          { id:uuid, number:int, orderId, status, lines[], reason?, refundAmount,
                                          restock:bool, restocked:bool, refunded:bool }
Counter   (inventory_counters)         { id:'orders'|'returns', value:int }   // serialized allocator
Settings  (inventory_settings)         { id:'general', storeName, currency, currencySymbol, taxRate, shippingFlat, lowStockThreshold }
```

- **Authority:** prices and on-hand stock are server-authoritative; stock changes only via `inventory_stock_movements` (
  sum of movements == on-hand). Reserved collections (`users`/`sessions`/`invites`) remain off-limits to the plugin.

### 5.2 Data Flow
Create/edit → sanitize blocks → Zod validate → write entry + revision → register cache tag → append audit. Publish → state transition → revalidate tags → (Site) render on next request → cache → CDN. (See dashboard data-flow diagram.)

### 5.3 Retention, Archival & Deletion
- Revisions retained per policy (configurable cap or age); archived entries retained until erasure.
- GDPR retention policies drive scheduled purges; sensitive data crypto-shredded on erasure.
- Audit log retained per compliance config; never silently deleted (purges are themselves audited).

### 5.4 Backup & Recovery
- Backup = snapshot of `/content`, `/media`, vault file, and DB (if used).
- SQLite index is **derived** and rebuildable from canonical files (idempotent rebuild on boot if checksum mismatch).
- Restore to a fresh host yields a working install (validated by RUNBOOK procedure).

## 6. API Design

### 6.1 Conventions
- Base path `/v1`; JSON bodies; UUID resource IDs; cursor pagination (`?cursor=&limit=`).
- **Auth:** Studio uses session cookie (httpOnly/Secure/SameSite) + CSRF token header on mutations. Public read endpoints are unauthenticated and published-scope only.
- **Error envelope:** `{ error: { code, message } }` — no stack traces, no PII, uniform across endpoints (anti-enumeration).
- **Versioning:** URL-versioned; SDK semver'd separately.

### 6.2 Endpoint Specifications (representative)

```
POST /v1/auth/login            Auth: none   Body:{email,password,otp?}  → {ok} + Set-Cookie | 401 uniform
POST /v1/auth/logout           Auth: session                            → 204
GET  /v1/content?type=&cursor= Auth: session+cap(content.read)          → {items[],nextCursor}
POST /v1/content               Auth: session+cap(content.create)+CSRF   Body:{typeId,blocks,...} → {id}
PUT  /v1/content/:id           Auth: session+cap(content.update)+CSRF   → {revision}
POST /v1/content/:id/publish   Auth: session+cap(content.publish)+CSRF  → {status:'published',rev}
GET  /v1/content/:id/revisions Auth: session+cap(content.read)          → {revisions[]}
POST /v1/media                 Auth: session+cap(media.write)+CSRF      multipart → {id} | 415 invalid
POST /v1/types                 Auth: session+cap(types.manage)+CSRF     → {id}    (no-code modeling)
POST /v1/plugins/install       Auth: session+cap(plugins.manage)+CSRF   → {capabilitiesRequested[]}
POST /v1/plugins/:id/approve   Auth: session+cap(plugins.manage)+CSRF   → {enabled:true}
POST /v1/gdpr/export           Auth: session+cap(gdpr.manage)+CSRF      Body:{subjectRef} → {jsonExport}
POST /v1/gdpr/erase            Auth: session+cap(gdpr.manage)+CSRF      Body:{subjectRef} → {tombstoneId}

# Public (Site)
GET  /*                         Front controller → resolve URL → SSR HTML (published-only)
ANY  /api/p/:plugin/:action     Dispatcher → capability check → plugin worker RPC
GET  /sitemap.xml , /robots.txt

# Public storefront (Inventory plugin endpoints, via the dispatcher above)
GET  /api/p/inventory/items     → published, in-stock product feed (safe projection)
POST /api/p/inventory/products  Body:{category?,tag?,search?,sort?,limit?} → filtered feed
POST /api/p/inventory/cart      Body:{items:[{itemId,variantId,qty}]}      → authoritative re-priced lines + totals
POST /api/p/inventory/checkout  Body:{items,customer:{name,email,...},note?} → {orderNumber} (validates+decrements stock)
```

Error codes: 400 validation, 401 unauthenticated (uniform), 403 capability denied, 404 not found (also for unauthorized-to-see), 409 conflict (revision), 415 invalid upload, 429 rate-limited, 500 internal (no detail leaked).

## 7. Security Design
(Full treatment in SAD-pressh.md.)

### 7.1 AuthN & AuthZ
- argon2id password hashing; httpOnly/Secure/SameSite session cookies; optional MFA (TOTP).
- RBAC: roles → capabilities; capability gate authoritative server-side; UI hides what it can't grant but never enforces.

### 7.2 Encryption
- In transit: TLS required in production (enforced; HSTS).
- At rest: `sensitive` fields and all secrets encrypted with AES-256-GCM. Key: `PRESSH_MASTER_KEY` supplied at boot.

### 7.3 Secrets Management
- Sealed vault behind `SecretsBackend`; file backend default. Plugins request by name → scoped short-lived token if capability held. Every access audited. Rotation re-encrypts.

### 7.4 Network Security
- Studio deployable behind VPN/SSO/IP allowlist; egress restricted to plugin-declared origins; strict CSP with declared external origins; reverse proxy terminates TLS.

### 7.5 Threat Model Summary
STRIDE table in SAD; mitigations map 1:1 to the 14 baselines. Primary risks: plugin RCE (→ worker isolation), stored XSS (→ sanitization + CSP), file-upload RCE (→ validation), secret exposure (→ vault).

### 7.6 Security Testing
- SAST + dependency scan + secret scan in CI; Playwright e2e for authz; fuzz block sanitizer with XSS corpus; periodic pentest (Wave 3).

## 8. Infrastructure Design

### 8.1 Cloud Architecture
Provider-agnostic. Reference: one Linux VM (Docker) running `site` and `studio` containers behind Caddy/Nginx; volume for `/content`,`/media`,`/plugins`; optional managed Postgres + S3-compatible store + CDN at scale.

### 8.2 Container & Orchestration
- Two images (or one image, two entrypoints): `pressh-site`, `pressh-studio`. `docker-compose.yml` for single-host; Kubernetes optional at scale (site as a horizontally-scaled Deployment, studio as a single replica).

### 8.3 Networking
- Proxy routes `/admin`→studio (allowlistable), everything else→site. Internal-only ports for app processes; TLS at the edge.

### 8.4 IaC
- `docker-compose.yml` checked in; optional Terraform/Helm modules in Wave 2/3. Config via env + a `pressh.config.ts`.

### 8.5 CI/CD
- Pipeline: typecheck → lint → unit/integration (Vitest) → build packages (`tsc -b`) → build apps (Vite) → dependency/secret/SAST scan → e2e (Playwright) → image build/sign → publish. Packages build to `dist/`; tests alias `@pressh/*`→`src`.

## 9. Observability Design
- **Logging:** pino structured JSON; `sensitive` fields redacted; correlation IDs across proxy→app→worker.
- **Metrics:** Prometheus — request rate, SSR p50/p99, cache hit ratio, worker restarts, auth failures, job lag.
- **Tracing:** OpenTelemetry spans across HTTP → engine → worker RPC.
- **Alerting:** SLO breach (p99 latency, error rate, worker crash-loop, disk) → runbook links (RUNBOOK-pressh.md).
- The append-only audit log doubles as a security/compliance signal.

## 10. Appendices

### Appendix A — Architecture Diagrams
See architecture-pressh-v1.html → **Diagrams** tab (C4 context/container, sequences, data flow, ER, state machine, deployment).

### Appendix B — Technology Stack (pinned, verified 2026-05-20)
| Component | Technology | Version | LTS/EOL | Source | Rationale |
|---|---|---|---|---|---|
| Runtime | Node.js | 24.15.0 (Active LTS) | maint. → ~Apr 2027 | nodejs.org | Production-safe LTS; native `worker_threads`, `node:sqlite`. |
| Language | TypeScript | 6.0.3 | stable (TS7 in beta) | typescriptlang.org | End-to-end type safety; stay on 6.0.x until TS7 GA. |
| HTTP server | Hono | 4.12.21 | current | hono.dev | Fast, Web-standard, runs on Node; same framework both apps. |
| Build/SSR | Vite | 8.0.13 | current major | vite.dev | Rolldown-powered builds; SSR for Site, SPA for Studio. |
| UI | React | 19.2.6 | current | react.dev | Studio SPA + theme components. |
| Tests | Vitest | 4.1.7 | supports Vite 8 | vitest.dev | Unit/integration; aliases to `src`. |
| Styling | Tailwind CSS | 4.3.0 | current major | tailwindcss.com | ui-kit + themes. |
| Validation | Zod | 4.4.3 | stable | zod.dev | Content-type/field schemas, API validation. |
| Index store | better-sqlite3 | 12.10.0 | current (or `node:sqlite`) | npmjs.com | Synchronous, fast SQLite index sidecar. |
| DB adapter target | PostgreSQL | 18.4 | → ~2030 | postgresql.org | Optional scale-out backend. |
| DB adapter | MongoDB driver | 7.2.0 | current | npmjs.com | Optional document backend. |
| Hashing | argon2 | latest | — | github.com/ranisalt/node-argon2 | Password hashing (argon2id). |

### Appendix C — Open Questions & Future Work
- Plugin marketplace/registry & signing key distribution (Wave 3).
- Multi-tenant SaaS variant (would change trust model + data layer — re-architect).
- Real-time collaborative editing (CRDT) — deferred.
- Adopt TypeScript 7.0 once GA (10× compile speed).
