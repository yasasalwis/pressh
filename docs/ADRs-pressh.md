# Architecture Decision Records — Pressh

Deciders: Architecture team · Date: 2026-05-20 unless noted.

---

## ADR-001: Unify on Hono + Vite SSR; drop Next.js
**Status:** Accepted

### Context
The public Site needs SEO/SSR and **WordPress-like runtime extensibility** — new content types, pages, and plugin endpoints must go live without a rebuild. Next.js routes and Server Actions are bound at build time and cannot be registered at runtime. Next *can* do dynamic resolution via catch-all routing, but the first build attempt was sunk largely by Next/monorepo build friction (the `build:packages`-before-`next build` dance, Turbopack not rewriting workspace `.js` imports).

### Decision
Drop Next.js. Run both apps on **Hono (HTTP) + Vite (build/SSR)**. Studio is a client-rendered SPA; Site is server-rendered via a Vite SSR pipeline served by Hono.

### Rationale
Unifies on one server framework, one build tool, one routing model, one trust model; removes the build friction; and the security rule that *plugin code never runs in the React tree* already neutralizes RSC's main benefit. Self-hosting means Vercel edge perks don't apply.

### Consequences
- (+) Full per-request control; no build step between publish and live; simpler mental model.
- (+) Eliminates the toolchain friction that blocked the prior build.
- (−) Must build in-house what Next gave for free: SSR render, tag-cache, image optimization, sitemap.
- Debt accepted: maintaining a small SSR/caching layer ourselves.

### Alternatives Considered
| Alternative | Pros | Cons | Why rejected |
|---|---|---|---|
| Keep Next.js + catch-all front controller | SSR/ISR/image batteries free; proven pattern | Build-model friction; Server Actions dead-end for plugins | Friction caused the restart; batteries buy little here |
| Pure SPA, no SSR | Simplest | Poor SEO — fatal for a CMS | SEO is a hard requirement |

---

## ADR-002: Two-process trust split (Studio vs Site)
**Status:** Accepted

### Context
Admin and public traffic have very different trust levels. A public-facing compromise must not reach admin sessions.

### Decision
Run **Studio** (admin) and **Site** (public) as separate OS processes, each with its own PluginHost and worker pool, sharing on-disk content/plugins but never process memory.

### Rationale
Strongest blast-radius isolation; independent scaling (site horizontal, studio single small node); studio can be firewalled off the public internet. Matches the security thesis.

### Consequences
- (+) Compromise of one process can't reach the other; independent restart/scale.
- (−) Two processes to supervise; cross-process cache invalidation needed; shared-storage write discipline.
- Mitigation: co-locate both on one host for small installs (logical isolation, minimal ops tax).

### Alternatives Considered
| Alternative | Pros | Cons | Why rejected |
|---|---|---|---|
| Single-process monolith (Option B) | Simplest ops, least RAM | Weaker trust boundary; can't firewall admin separately | Undercuts the core differentiator |
| Static-first hybrid (Option C) | Best perf, tiny attack surface | Weak dynamism; publish-build latency | Conflicts with instant-live requirement |

---

## ADR-003: Uniform worker-thread plugin isolation (no trusted tier)
**Status:** Accepted

### Context
WordPress's worst vulnerabilities come from plugins running with full in-process privileges (RCE, SQLi). Extensibility is required but must not reintroduce that risk.

### Decision
**Every** plugin runs in its own Node `worker_threads` worker. The host never `import()`s plugin code. Plugins communicate only via structured-clone RPC over `parentPort`. There is **no** privileged/first-party fast path.

### Rationale
A single uniform model is the whole point — any exception becomes the attack path. One worker per plugin gives fault isolation.

### Consequences
- (+) Plugin RCE cannot reach the host; faults are contained; plugins can be killed/restarted.
- (−) ~ms RPC overhead per cross-boundary call → design for bulk ops and memoize output; hooks are async by definition.

### Alternatives Considered
| Alternative | Pros | Cons | Why rejected |
|---|---|---|---|
| In-process plugins (WordPress model) | Fast, simple SDK | RCE/SQLi/secret exposure | Exactly the failure mode the product exists to kill |
| Tiered trust (first-party in-process) | Faster first-party | An exception that becomes the exploit | Breaks the uniform invariant |
| V8 isolates / vm | Lighter than threads | Weaker isolation guarantees in Node | worker_threads give a cleaner boundary |

---

## ADR-004: Default-deny capability model
**Status:** Accepted

### Context
Plugins need *some* access (storage, network, media, secrets) but must not get blanket privileges.

### Decision
Plugin manifests **declare** required capabilities (e.g., `storage.read:posts`, `network.fetch:api.stripe.com`, `media.write`, `storage.raw`). The user approves them at install. At runtime, the host checks every cross-boundary RPC against granted capabilities **before** acting. Default is deny.

### Rationale
Least privilege, made explicit and user-visible. Plugins have no channel to the host except the SDK, so they cannot escape the gate.

### Consequences
- (+) Tight, auditable least-privilege; clear user consent.
- (−) Authors must enumerate needs; some flows need new fine-grained capabilities over time.

### Alternatives Considered
Coarse all-or-nothing permissions (rejected: too broad); no gating (rejected: defeats the purpose).

---

## ADR-005: Iframe-sandboxed plugin admin UI
**Status:** Accepted

### Context
Plugins contribute admin panels. Running their JS in the Studio window would expose Studio cookies/session/DOM.

### Decision
Render plugin admin panels in **iframes** served from a Studio route with strict CSP and `sandbox="allow-scripts allow-forms"`. Communication is via `postMessage` only.

### Rationale
Prevents same-origin access to Studio session; plugin JS never runs in Studio's window.

### Consequences
- (+) Admin UI compromise is contained; no cookie theft.
- (−) More constrained DX than in-tree React components; postMessage protocol to maintain.

### Alternatives Considered
In-tree React plugin components (rejected: full access to Studio context — unacceptable).

---

## ADR-006: Filesystem-default storage + SQLite index; adapter interface for DBs
**Status:** Accepted

### Context
Self-hosters want zero-dependency setup; larger sites need a real database.

### Decision
Default store is the **filesystem** (content as structured files) with a **SQLite index** sidecar for queries. A single `StorageAdapter` interface allows optional **Postgres/SQLite/Mongo** adapters. Plugins get **no raw DB access** by default; `storage.raw` is a separately-gated capability.

### Rationale
One-command setup with no DB; the index keeps queries fast; the adapter lets sites scale without changing app code. The canonical files make backup/restore and index rebuild trivial.

### Consequences
- (+) Trivial setup and backup; portable; no DB lock-in.
- (−) FS has a write-contention ceiling (~100k entries) → migrate to Postgres; index must stay in sync (rebuildable, idempotent).

### Alternatives Considered
DB-required (rejected: kills self-host simplicity); DB-only no-index FS (rejected: no fast queries on FS default).

---

## ADR-007: Front-controller (catch-all) routing for runtime extensibility
**Status:** Accepted

### Context
Adding a content type, page, or plugin endpoint must be live immediately, without a rebuild — the WordPress behavior.

### Decision
One **catch-all public route** resolves every URL at request time via the engine/storage; one **catch-all API dispatcher** routes every `/api/p/<plugin>/<action>` to the plugin host at runtime based on an endpoint registry. Server Actions are not used for extensibility.

### Rationale
Routing becomes data-driven, not file/build-driven; new content/endpoints are served on the next request. Mirrors PHP's `index.php` front controller.

### Consequences
- (+) Zero-rebuild dynamism; clean single dispatch point for authz/caching.
- (−) Resolution happens per request → mitigated by content-tag caching (ADR-012).

### Alternatives Considered
File-based routes per content type (rejected: requires rebuild/redeploy); Server Actions per plugin (rejected: build-time bound, and would run plugin code in the React tree).

---

## ADR-008: GDPR data-subject rights as core engine features
**Status:** Accepted

### Context
Strict GDPR is a hard v1 requirement, not "good hygiene."

### Decision
Build **export (Art. 15/20), erasure (Art. 17), consent (Art. 6/7), retention (Art. 5(1e))** as first-class `GdprService` operations in the engine, backed by the audit log (Art. 30).

### Rationale
Data-subject rights touch every store; only a core service can guarantee complete cascade and auditability. Bolting on later misses records.

### Consequences
- (+) Compliant by construction; complete export/erasure across stores.
- (−) All entities must declare their subject linkage and sensitivity; adds modeling discipline.

### Alternatives Considered
Plugin-provided GDPR tooling (rejected: can't guarantee completeness or trust an untrusted plugin with erasure).

---

## ADR-009: Sealed AES-256-GCM secrets vault; scoped tokens to plugins
**Status:** Accepted

### Context
WordPress leaks secrets via plugins reading `process.env`/config. Plugins need *some* secrets (API keys).

### Decision
A sealed vault behind a `SecretsBackend` interface, default **file-based AES-256-GCM** keyed by `PRESSH_MASTER_KEY`. Plugins request a secret **by name** and receive a short-lived **scoped token** only if their manifest holds the capability. Plugins never see `process.env`.

### Rationale
No ambient secret access; least privilege; every access audited; rotation re-encrypts.

### Consequences
- (+) Secrets never in plugin memory as raw env; auditable; rotatable.
- (−) Operator must supply/protect the master key; vault is a fail-closed boot dependency.

### Alternatives Considered
Env-var secrets (rejected: ambient exposure); external secret manager only (kept as an optional backend behind the same interface).

---

## ADR-010: Append-only, hash-chained audit log
**Status:** Accepted

### Context
Tamper-evident records of mutations, access, and logins are needed for security and GDPR Art. 30.

### Decision
Every mutation, capability use, login, and data access writes an **append-only** entry whose `hash` chains the `prevHash`. Audit write failure fails the operation closed.

### Rationale
Detects tampering; satisfies records-of-processing; provides incident forensics.

### Consequences
- (+) Tamper-evident, complete trail.
- (−) Write amplification on every mutation; storage grows (retention-managed, purges audited).

---

## ADR-011: Plugin signing + CVE gate
**Status:** Accepted

### Context
Supply-chain risk: malicious or known-vulnerable plugins.

### Decision
Plugins ship a `pressh.signature.json`. **Production requires a valid signature** (dev allows unsigned, or `PRESSH_ALLOW_UNSIGNED=1`). A CVE feed sync job flags known-vulnerable plugins; the host **refuses to load** flagged plugins.

### Rationale
Integrity + known-vuln prevention without a central registry in v1.

### Consequences
- (+) Blocks tampered/known-bad plugins.
- (−) Authors must sign; CVE feed availability needed (degrades gracefully — warns if stale).

### Alternatives Considered
Central registry (deferred to Wave 3); no verification (rejected).

---

## ADR-012: Content-tag caching with on-publish invalidation
**Status:** Accepted

### Context
Front-controller resolution is per-request; the Site still needs CDN-speed.

### Decision
Cache rendered public responses keyed by **content tag** (content identity + dependencies), not by time. On publish/change, `revalidateTag` purges exactly the affected entries; personalized responses bypass cache. Plugin output is memoized per content revision.

### Rationale
Combines instant-live dynamism with CDN performance; precise invalidation avoids stale pages and over-purging.

### Consequences
- (+) Fast and fresh; minimal origin load.
- (−) Dependency tracking must be correct or pages go stale/over-purge; cross-process invalidation needed (ADR-002).

## ADR-013: E-commerce as a plugin with recorded payments + a pluggable gateway

**Status:** Accepted

### Context

Pressh needed full store capability (catalog, orders, returns, payments). Building it into the engine would couple the
content core to commerce and widen the trusted surface; integrating a live payment processor in v1 would add
external-network + webhook trust and require operator secrets.

### Decision

Ship commerce as the first-party **Inventory** plugin, with all data in plugin-owned, capability-gated collections (
never `content_entries`). Payments are **recorded** behind a `PaymentGateway` interface (`{ charge, refund }`); v1 ships
only a no-network `manual` gateway. Orders price and validate stock server-side and decrement through the audited stock
ledger.

### Rationale

Keeps the engine generic and the commerce blast radius inside one capability-scoped worker (consistent with
ADR-003/004). The gateway seam lets a real processor (Stripe, …) drop in later with no change outside its
implementation. Recorded-payments-first matches the self-hosted, security-first posture — no external secrets or
callback surface in v1.

### Consequences

- (+) No new trusted tier; commerce isolated like any plugin; clean upgrade path to a live gateway.
- (+) Server-authoritative pricing/stock prevents client price tampering / oversell.
- (−) v1 does not charge cards — payments are reconciled, not captured (documented in SRS FR-064).
- (−) Cross-process stock races are bounded only within a worker; checkout happens on the Site process (acceptable for
  v1; documented).

### Alternatives Considered

- **Commerce in the engine core:** rejected — couples core to commerce, widens trusted surface.
- **Live Stripe integration in v1:** deferred — adds secrets, webhooks, and external-network trust; the seam preserves
  the option.

## ADR-014: Plugin-contributed designer widgets (enabled-only presets)

**Status:** Accepted

### Context

Plugins (e.g. the store) need to add their own drag-and-drop blocks to the page designer. Hardcoding them in the engine
palette would show commerce widgets even without the plugin and couple the engine to product features.

### Decision

A plugin manifest may declare `designerPresets` (a presets JSON of primitive-node templates). The PluginHost loads +
sanitizes them (shape-checked, size-capped, ids namespaced `plugin:id`) and exposes them **only for enabled plugins**;
the Studio designer-library endpoint merges them into the palette and instantiates them client-side. Any new rendered
behaviour they need (e.g. add-to-cart) is provided by generic, type-validated engine primitives — not plugin-injected
markup.

### Rationale

Reuses the existing preset/primitive model and the strict no-inline-style/script renderer, so contributed widgets
inherit the same XSS/CSP guarantees. Gating on *enabled* keeps the palette scoped to installed capability, mirroring
endpoint dispatch (ADR-007).

### Consequences

- (+) Reusable for any plugin; commerce widgets appear/disappear with the plugin; no engine coupling.
- (+) Contributed content can't break the CSP — it renders through the validated primitive pipeline.
- (−) Presets are limited to the existing primitive set; a genuinely new widget behaviour requires a new engine
  primitive.
- (+) `presets.json` is covered by the plugin signature (a `files` map alongside the `main` hash): the host rejects a
  tampered or missing presets file at load, on top of load-time sanitization and the no-inline renderer.

### Alternatives Considered

- **Hardcode commerce presets in the engine:** rejected — always-on, couples engine to product features.
- **Let plugins inject raw HTML/CSS widgets:** rejected — breaks the no-inline CSP guarantee and the sandboxing model.
