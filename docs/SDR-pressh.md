# System Design Report — Pressh

**Status:** Approved · **Date:** 2026-05-20 · **Audience:** leadership / technical review board

---

## Executive Summary
Pressh is a self-hosted, no-code content management system built end-to-end in TypeScript, positioned as a **secure-by-default alternative to WordPress**. WordPress powers a large share of the web but is the single largest source of website data breaches — almost always through its plugin ecosystem, which runs third-party code with full in-process privileges. Pressh keeps the thing customers love about WordPress (extensible, no-code authoring) while removing the thing that gets them breached: it runs **every** plugin in an isolated worker thread behind a default-deny capability gate, never executes third-party code in the page-render path, and bakes security controls (CSRF, sanitization, UUIDs, capability checks, encrypted secrets) into the core so extension authors cannot forget them. It ships fully no-code — non-technical users model content, build pages, manage menus/forms, and customize themes without writing code — is server-rendered for SEO, and meets strict GDPR data-subject requirements out of the box. The design is delivered as a dependency-ordered 19-phase build plan sized for incremental, agent-assisted implementation.

## Business Context & Problem Statement
- **Market:** WordPress runs a plurality of the web; its security reputation is poor, driven by plugin/theme vulnerabilities (RCE, SQLi, IDOR, file-upload RCE) and slow, heavyweight stacks.
- **Problem:** Organizations want WordPress-class flexibility without WordPress-class risk and bloat.
- **Opportunity:** A TypeScript, security-first CMS that is genuinely no-code and self-hostable, where "the data doesn't leak" is an architectural guarantee rather than a marketing claim.

## Solution Overview
Two cooperating processes on a unified **Hono + Vite (SSR)** stack:
- **Studio** (admin SPA + Hono) — no-code authoring, modeling, theming, plugin management.
- **Site** (public, Hono + Vite SSR) — server-rendered, SEO-friendly, content-tag cached.
Shared TypeScript packages (`core`, `engine`, `sdk`, `runtime`, `ui-kit`) hold all framework-agnostic and security-relevant logic. A **front-controller** resolves any URL or plugin endpoint at request time, giving WordPress-like "add it and it's live" dynamism with no rebuild. Storage is filesystem-by-default (SQLite-indexed), swappable to Postgres/SQLite/Mongo. Plugins are worker-isolated and capability-gated; their admin UIs are iframe-sandboxed. GDPR export/erasure/consent/retention are first-class engine features.

## Architecture Decision Summary
| ADR | Decision                                                       | Why it matters                                                              |
|-----|----------------------------------------------------------------|-----------------------------------------------------------------------------|
| 001 | Hono + Vite SSR (drop Next.js)                                 | Removes build friction; full runtime control; SEO retained via in-house SSR |
| 002 | Two-process trust split                                        | Public compromise can't reach admin                                         |
| 003 | Uniform worker isolation                                       | Eliminates plugin-RCE blast radius                                          |
| 004 | Default-deny capabilities                                      | Least privilege, user-approved                                              |
| 005 | Iframe-sandboxed plugin UI                                     | No session/cookie theft from admin                                          |
| 006 | FS-default storage + adapters                                  | Zero-dep setup, scales to DB                                                |
| 007 | Front-controller routing                                       | Instant-live content/endpoints                                              |
| 008 | GDPR in core                                                   | Compliant by construction                                                   |
| 009 | Sealed secrets vault                                           | No ambient secret exposure                                                  |
| 010 | Hash-chained audit log                                         | Tamper-evident accountability                                               |
| 011 | Plugin signing + CVE gate                                      | Supply-chain defense                                                        |
| 012 | Content-tag caching                                            | Fast *and* fresh                                                            |
| 013 | E-commerce as a plugin + recorded payments / pluggable gateway | Store capability with no new trusted tier; live-processor upgrade path      |
| 014 | Plugin-contributed designer widgets (enabled-only)             | Plugins add palette blocks safely; commerce widgets scoped to the plugin    |

## Risk Register
| ID   | Description                                                     | Likelihood | Impact | Mitigation                                                                                                       | Owner    | Status    |
|------|-----------------------------------------------------------------|------------|--------|------------------------------------------------------------------------------------------------------------------|----------|-----------|
| R-1  | Worker-isolation escape via RPC serialization flaw              | Low        | High   | Strict structured-clone boundary; pentest; fuzz RPC                                                              | Security | Open      |
| R-2  | FS-default storage hits write-contention ceiling                | Med        | Med    | SQLite index; document Postgres migration trigger (~100k entries)                                                | Eng      | Open      |
| R-3  | Cache dependency tracking incorrect → stale/over-purge          | Med        | Med    | Conservative tag dependencies; integration tests                                                                 | Eng      | Open      |
| R-4  | Operator mishandles `PRESSH_MASTER_KEY`                         | Med        | High   | Docs + boot validation; support external secret backends                                                         | Ops      | Open      |
| R-5  | Plugin-heavy pages slow due to RPC latency                      | Med        | Med    | Memoize plugin output per revision; batch RPC                                                                    | Eng      | Open      |
| R-6  | Ops burden higher than WordPress drop-in                        | Med        | Med    | One-command compose; co-locate processes for small installs                                                      | Product  | Open      |
| R-7  | Scope creep toward multi-tenant SaaS mid-build                  | Low        | High   | Explicitly out of v1; re-architect gate before any SaaS work                                                     | Product  | Open      |
| R-8  | Incomplete GDPR cascade misses a store                          | Low        | High   | Entities declare subject linkage; export/erase integration tests                                                 | Eng      | Open      |
| R-9  | Storefront client tampers with price / oversells                | Low        | High   | Public cart/checkout recompute price + validate stock server-side; ledger decrement with non-negative guard      | Eng      | Mitigated |
| R-10 | "Recorded payments" mistaken for real charges by operators      | Med        | Med    | Documented in SRS FR-064/README; `manual` gateway only; ledger ≠ capture; gateway seam for a real processor      | Product  | Open      |
| R-11 | Plugin `presets.json` not covered by signature (only `main` is) | Low        | Med    | Load-time shape sanitization + size caps; renderer escapes/validates all preset content (no inline style/script) | Security | Open      |
| R-12 | Customer order PII (name/email/address) widens GDPR scope       | Med        | Med    | Add `inventory_orders` to GDPR subject scopes before storefront go-live; retention policy on orders              | Eng      | Open      |

## Quality Attributes Assessment
- **Security (primary):** Strong. Uniform isolation + capability gating + 14 baselines directly counter the modeled threats. Residual: isolation is only as strong as the RPC boundary (R-1) — pentest priority.
- **Performance:** Good for target scale. Content-tag cache + CDN keep public latency low; plugin RPC is the main hot-path cost (mitigated by memoization).
- **Reliability:** Good. Fail-closed workers, idempotent jobs, rebuildable index. Single-node by default; HA is opt-in (≥2 stateless site nodes).
- **Maintainability:** Strong. Clear package boundaries; security logic centralized; CI gates.
- **Cost:** Strong for self-host. Runs on one small VM at launch (~$25–75/mo incl. CDN/SMTP); scales linearly.

## Build vs. Buy Summary
**Build:** CMS core/engine, plugin host + isolation, auth/RBAC, GDPR service, SSR/cache layer — these *are* the product. **Buy:** CDN, SMTP, object storage, optional managed database. Rationale: differentiation and trust-critical paths are built; commodity infrastructure is bought.

## Implementation Roadmap (milestones)
- **M1 — Foundations (phases 0–4):** monorepo + tooling, core kernel, storage + index, vault + audit, auth/RBAC. *Outcome:* secure backbone with tests.
- **M2 — Content engine (phases 5–8):** content model + workflow, blocks + sanitization, query resolver, plugin host. *Outcome:* content can be created, versioned, and rendered; plugins run isolated.
- **M3 — Apps & no-code (phases 9–13):** Site (front controller + SSR + cache), Studio (no-code builders), theming, plugin admin UI, GDPR features. *Outcome:* a usable, secure, GDPR-compliant no-code CMS (MVP).
- **M4 — Scale & ops (phases 14–17):** jobs, CVE/signing, DB adapters, observability + Docker/CLI. *Outcome:* operable and horizontally scalable.
- **M5 — Hardening (phase 18):** TLS enforcement, security scanning, e2e + load tests, pentest, docs. *Outcome:* production-ready 1.0.
- **M6 — Commerce (phases 19–22):** Inventory plugin → full store (catalog+variants, stock ledger,
  orders/returns/recorded payments), plugin→designer widget mechanism + commerce primitives, and the storefront
  runtime (SSR product feed + cart/checkout). *Outcome:* a self-hosted store on the same isolation model; 440 tests
  green.

Detailed, agent-executable steps and acceptance gates: **IMPLEMENTATION-pressh.md**.

## Open Issues & Decisions Required
- Plugin distribution/registry model for Wave 3 (central vs. decentralized signing).
- Whether to ship a hosted SaaS tier later (would trigger a trust-model re-architecture).
- Timing of TypeScript 7.0 adoption (currently beta; GA pending).
- HA reference topology to document/support officially.

## Glossary
See SRS §1.3 / Appendix C. Key: **front controller** (catch-all request-time resolver), **capability** (grantable least-privilege permission), **crypto-shred** (destroy key to render data unrecoverable), **tag cache** (cache keyed by content identity).
