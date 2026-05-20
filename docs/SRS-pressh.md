# Software Requirements Specification — Pressh v1.0

**Status:** Approved · **Date:** 2026-05-20 · **Standard:** IEEE 830
**System:** Pressh — secure-by-default, no-code, self-hosted CMS (TypeScript)

---

## 1. Introduction

### 1.1 Purpose
This document specifies the complete requirements for **Pressh**, a self-hosted, no-code content management system built end-to-end in TypeScript. It is the authoritative reference for what the system must do and the quality attributes it must meet. Audience: product stakeholders (for sign-off), engineers (for implementation scope), and the security team (for control verification).

### 1.2 Scope
Pressh is a WordPress alternative whose central differentiator is **security** — specifically eliminating the data-leakage failure modes that plague WordPress (plugin RCE, SQL injection in plugin code, IDOR, REST user enumeration, file-upload RCE, in-process secret exposure). Pressh lets non-technical users **model content, build pages, manage navigation and forms, and customize themes without writing code**, while developers extend it with TypeScript plugins and themes that run inside a hardened, capability-gated isolation boundary.

In scope for v1:
- Self-hosted, single-tenant deployment (one install = one site's data).
- Full no-code authoring: content-type modeling, drag-drop block page building, menus, forms, theming.
- Multi-user authoring with roles and a draft→review→publish workflow.
- Worker-isolated, capability-gated plugin runtime; iframe-sandboxed plugin admin UI.
- Filesystem-default storage with optional Postgres/SQLite/Mongo adapters.
- Strict GDPR data-subject features (export, erasure, consent, retention).
- Public site server-rendered for SEO; admin studio as an SPA.

Out of scope for v1: multi-tenant SaaS hosting, a hosted plugin marketplace/registry, billing, and managed cloud operation (these are future waves).

### 1.3 Definitions, Acronyms, Abbreviations
| Term | Definition |
|---|---|
| **Studio** | The admin application (Vite SPA + Hono server) used to author and configure the site. |
| **Site** | The public-facing application (Hono + Vite SSR) that serves rendered content to visitors. |
| **PluginHost** | The host-side component that loads, supervises, and brokers RPC to plugin workers. |
| **Capability** | A named, grantable permission (e.g., `storage.read:posts`) checked on every cross-boundary call. |
| **Block** | A typed, sanitizable unit of page content. |
| **Content Type** | A user-defined schema (fields) describing a class of content entries. |
| **Front Controller** | A catch-all route that resolves any URL/endpoint at request time. |
| **Adapter** | An implementation of `StorageAdapter` for a specific backing store. |
| RCE / IDOR / CSP / RBAC / RPC | Standard industry acronyms (Remote Code Execution / Insecure Direct Object Reference / Content Security Policy / Role-Based Access Control / Remote Procedure Call). |

### 1.4 References
- TDD-pressh.md — Technical Design Document
- SAD-pressh.md — Security Architecture Document
- ADRs-pressh.md — Architecture Decision Records
- IMPLEMENTATION-pressh.md — phase-by-phase build guide
- architecture-pressh-v1.html — interactive architecture dashboard
- GDPR (Regulation (EU) 2016/679), Articles 5, 6, 7, 15, 17, 20, 30, 32

### 1.5 Document Overview
Section 2 describes the product context and constraints; Section 3 lists functional, non-functional, and interface requirements with stable IDs; Section 4 provides use cases, a data dictionary, and a glossary.

---

## 2. Overall Description

### 2.1 Product Perspective
Pressh is a new, greenfield, self-contained system distributed as a Docker image / npm package. It runs as **two cooperating processes** — Studio (admin) and Site (public) — sharing on-disk content and plugins but never sharing process memory. It interfaces with: a reverse proxy/CDN (TLS, caching), an SMTP service (transactional mail), an optional external database, an optional S3-compatible object store (media), and a plugin CVE feed. Shared TypeScript packages (`@pressh/core`, `@pressh/engine`, `@pressh/sdk`, `@pressh/runtime`, `@pressh/ui-kit`) provide framework-agnostic logic to both apps.

### 2.2 Product Functions (summary)
- Author and manage content (pages, posts, custom types) with revisions and i18n.
- Visually model content types and fields (no code).
- Build pages from sanitized blocks via drag-and-drop.
- Manage menus/navigation, forms, and media.
- Manage users, roles, and a review/publish workflow.
- Install, configure, and isolate plugins and themes.
- Serve a fast, SEO-friendly public site with content-tag caching.
- Satisfy GDPR data-subject requests.
- Produce an append-only audit trail of all mutations and access.

### 2.3 User Classes and Characteristics
| Class | Description | Technical level |
|---|---|---|
| **Owner** | Ultimate authority; manages billing-equivalent settings, all users, destructive operations. | Low–medium |
| **Admin** | Manages users (except owner), plugins, themes, settings. | Low–medium |
| **Editor** | Reviews and publishes any content; manages menus/forms. | Low |
| **Author** | Creates and edits own content; submits for review. | Low |
| **Viewer** | Read-only admin access (e.g., analytics, drafts). | Low |
| **Plugin/Theme Developer** | Writes TypeScript extensions against the SDK. | High |
| **Anonymous Visitor** | Consumes the public site. | N/A |
| **Data Subject** | Person whose personal data is processed; exercises GDPR rights. | N/A |

### 2.4 Operating Environment
- **Runtime:** Node.js 24 LTS.
- **OS:** Linux (primary), macOS (dev). Containerized via Docker.
- **Browsers (Studio):** evergreen Chromium, Firefox, Safari.
- **Storage:** local filesystem + SQLite index by default; optional Postgres 18 / MongoDB / SQLite via adapter.
- **Network:** TLS required in production; Studio deployable behind VPN/SSO/IP allowlist.

### 2.5 Design and Implementation Constraints
- TypeScript end-to-end; no PHP, no per-request interpreted plugin model.
- **All** plugins run in worker threads — no privileged/trusted tier (security invariant).
- Plugin code never executes in the React render tree.
- Library packages are consumed as built `dist/` JS by the apps; tests run against `src` via aliases.
- The 14 secure-by-default baselines (Section 3.2, NFR-SEC) are mandatory, not opt-in.
- Strict GDPR support is a v1 requirement, not a later add-on.

### 2.6 Assumptions and Dependencies
- The operator provides `PRESSH_MASTER_KEY` securely at boot (env/secret manager).
- The operator provides TLS termination (proxy) and DNS.
- A CDN is available in front of the Site for caching at the target scale.
- SMTP credentials are available for transactional email.
- The CVE feed endpoint is reachable for supply-chain checks (degrades gracefully if not).

---

## 3. Specific Requirements

### 3.1 Functional Requirements

#### Authentication, Users & Access

**[FR-001] User authentication**
Priority: High
Description: The system shall authenticate users via email + password using argon2id hashing, issue an httpOnly, Secure, SameSite session cookie, and support optional MFA.
Acceptance Criteria: Valid credentials create a session; invalid credentials fail with a uniform error revealing no account existence; sessions expire and can be revoked; MFA, when enabled, is enforced on login.

**[FR-002] Brute-force protection**
Priority: High
Description: The system shall rate-limit authentication attempts and lock an account after a configurable number of failures.
Acceptance Criteria: After N failed attempts within the window, further attempts are rejected/delayed and an audit entry is recorded; lockout auto-expires or is admin-clearable.

**[FR-003] Role-based access control**
Priority: High
Description: The system shall assign users one or more roles (Owner, Admin, Editor, Author, Viewer) that resolve to capabilities, and shall enforce capabilities on every privileged operation.
Acceptance Criteria: An Author cannot publish; an Editor can; a Viewer can read but not mutate; capability checks are enforced server-side regardless of UI state.

**[FR-004] CSRF protection**
Priority: High
Description: All state-changing requests shall require a valid CSRF token, enforced centrally by the SDK so extension authors cannot omit it.
Acceptance Criteria: A mutation without a valid token is rejected; the protection cannot be bypassed by a plugin endpoint.

#### Content Modeling & Authoring

**[FR-010] No-code content-type modeling**
Priority: High
Description: Users with the capability shall create, edit, and delete content types and their fields (text, rich text, number, boolean, date, media, reference, repeater, select, sensitive) entirely through the Studio UI.
Acceptance Criteria: A new content type becomes immediately usable for authoring without a code change or redeploy; field validation is enforced via generated schemas.

**[FR-011] Block-based page authoring**
Priority: High
Description: Users shall compose content from typed blocks via drag-and-drop, reorder, nest, and configure blocks.
Acceptance Criteria: Pages render the composed blocks; block content is sanitized; unknown/disabled blocks degrade gracefully.

**[FR-012] Content lifecycle & workflow**
Priority: High
Description: Content shall move through Draft → In Review → (Scheduled) → Published → Archived, with capability-gated transitions and an option to schedule future publication.
Acceptance Criteria: State transitions enforce capabilities; scheduled content publishes automatically at its time; the full state machine in the TDD is honored.

**[FR-013] Revisions**
Priority: High
Description: Every save shall create an immutable revision; users shall view and restore prior revisions.
Acceptance Criteria: Revision history is complete and ordered; restoring creates a new revision rather than mutating history.

**[FR-014] Internationalization**
Priority: Medium
Description: Content shall support per-locale variants with independent revisions and clean per-locale URLs.
Acceptance Criteria: A locale variant can be created, edited, and published independently; URLs resolve to the correct locale.

**[FR-015] Media management with safe upload**
Priority: High
Description: Users shall upload and manage media; the system shall validate uploads by magic-byte + content-type + extension whitelist and store files outside any web root.
Acceptance Criteria: A disguised executable/polyglot is rejected; valid media is stored, served via a controlled route, and never directly executable.

**[FR-016] Menus / navigation builder**
Priority: Medium
Description: Users shall build site navigation menus by linking to content, custom URLs, or taxonomy.
Acceptance Criteria: Menus render on the site; reordering and nesting persist.

**[FR-017] Form builder**
Priority: Medium
Description: Users shall build forms (fields, validation, destination) without code; submissions shall be stored and/or emailed.
Acceptance Criteria: A built form validates input, stores submissions, and respects consent/retention settings.

#### Theming & Extensibility

**[FR-020] Theme selection & visual customization**
Priority: High
Description: Users shall select a curated theme and customize design tokens (colors, fonts, spacing, layout) through guided controls with live preview.
Acceptance Criteria: Token changes preview in a sandboxed iframe and apply to the public site on publish; no raw template/CSS injection is required of the user.

**[FR-021] Plugin installation & capability approval**
Priority: High
Description: Admins shall install plugins from a bundle; the system shall display the plugin's requested capabilities and require explicit approval before granting them.
Acceptance Criteria: Capabilities not approved are denied at runtime; an unsigned plugin is rejected in production (configurable override for dev).

**[FR-022] Plugin runtime isolation**
Priority: High
Description: Every plugin shall execute in its own worker thread and communicate with the host only via capability-checked RPC.
Acceptance Criteria: A plugin cannot access host globals, other plugins, secrets it wasn't granted, or the raw database; attempting a non-granted capability is denied and audited.

**[FR-023] Plugin admin UI**
Priority: Medium
Description: Plugins may contribute admin panels rendered in sandboxed iframes communicating via postMessage.
Acceptance Criteria: Plugin admin JS cannot access Studio cookies/session; the panel functions through the postMessage bridge only.

**[FR-024] Plugin-defined endpoints (dynamic)**
Priority: High
Description: Newly installed plugins may expose HTTP endpoints that become available at request time without a rebuild, routed through the front-controller dispatcher.
Acceptance Criteria: After install/approval, `POST /api/p/<plugin>/<action>` is served by the plugin worker; uninstalling removes it; no redeploy is required.

#### Public Site

**[FR-030] Dynamic URL resolution (front controller)**
Priority: High
Description: The Site shall resolve any public URL at request time against the engine/storage; newly created content/types/pages shall be live without a rebuild.
Acceptance Criteria: Publishing a new page makes its URL resolvable on the next request; no build step is required.

**[FR-031] Public scoping**
Priority: High
Description: Public endpoints shall return only published content and shall expose no user-identifying or enumeration data.
Acceptance Criteria: Drafts/private content are unreachable publicly; no endpoint enumerates users; IDs are non-sequential UUIDs.

**[FR-032] Server-side rendering & SEO**
Priority: High
Description: The Site shall server-render pages and emit SEO essentials (meta tags, canonical URLs, sitemap.xml, robots.txt, structured data hooks).
Acceptance Criteria: Rendered HTML contains content without client JS; sitemap reflects published content; pages are crawlable.

**[FR-033] Content-tag caching**
Priority: High
Description: The Site shall cache rendered responses by content tag and invalidate them when underlying content changes.
Acceptance Criteria: A published edit invalidates exactly the affected pages; unaffected pages stay cached; personalized responses bypass cache.

#### GDPR / Compliance

**[FR-040] Data-subject export**
Priority: High
Description: An admin shall export all personal data associated with a data subject in a machine-readable format (Art. 15/20).
Acceptance Criteria: Export includes all records keyed to the subject across content, submissions, and logs; output is valid JSON.

**[FR-041] Right to erasure**
Priority: High
Description: The system shall erase a data subject's personal data on request, cascading across stores, crypto-shredding sensitive fields, and recording an audited tombstone (Art. 17).
Acceptance Criteria: After erasure, the subject's personal data is unrecoverable; the erasure event is in the audit log; referential integrity is preserved via tombstones.

**[FR-042] Consent management**
Priority: High
Description: The system shall capture, store, and honor consent (incl. a cookie consent banner) and make consent state auditable (Art. 6/7).
Acceptance Criteria: Non-essential processing does not occur without consent; consent changes are recorded with timestamp and scope.

**[FR-043] Retention & purge**
Priority: Medium
Description: Operators shall configure retention policies; the scheduler shall purge data past retention (Art. 5(1e)).
Acceptance Criteria: Data older than its retention policy is purged on schedule; purges are audited.

#### Platform & Operations

**[FR-050] Append-only audit log**
Priority: High
Description: The system shall record every mutation, capability use, login, and data access in an append-only, hash-chained log.
Acceptance Criteria: Entries cannot be silently modified; tampering is detectable via the hash chain; the log is queryable by admins with the capability.

**[FR-051] Secrets vault**
Priority: High
Description: Secrets shall be stored in a sealed AES-256-GCM vault; plugins request secrets by name and receive scoped tokens only if granted.
Acceptance Criteria: No secret is exposed via `process.env` to plugins; secret access is audited; key rotation re-encrypts the store.

**[FR-052] Background jobs**
Priority: Medium
Description: The system shall run persisted, capability-gated background jobs (scheduled publish, cache warm, backups, CVE sync) that survive restarts and are idempotent.
Acceptance Criteria: A scheduled job runs at its time, resumes after downtime (catch-up), and produces the same result if retried.

**[FR-053] Backup & restore**
Priority: High
Description: The system shall provide CLI backup and restore of content, media, vault, and (if used) database.
Acceptance Criteria: A backup can be restored to a fresh host yielding a working install; the SQLite index is rebuildable from canonical files.

**[FR-054] Storage adapter swap**
Priority: Medium
Description: Operators shall switch the storage backend (FS, Postgres, SQLite, Mongo) via configuration and a migration tool.
Acceptance Criteria: The same functional test suite passes against each adapter; migration preserves all content and revisions.

### 3.2 Non-Functional Requirements

**[NFR-PERF-001] Performance**
- Cached public page TTFB ≤ 100 ms at the edge; SSR (cache miss) p99 ≤ 400 ms on the reference 2 vCPU node.
- Admin API p99 ≤ 300 ms for typical operations.
- Plugin RPC round-trip overhead ≤ ~5 ms p50; plugin-heavy pages must memoize output per content revision.

**[NFR-SCALE-002] Scalability**
- Site processes are stateless and horizontally scalable behind a proxy.
- Single reference node serves a site at low-millions of monthly views with a CDN; 3× site nodes + managed Postgres target ≥ 1.5k req/s SSR.

**[NFR-AVAIL-003] Availability**
- Target 99.9% for a single-node install; HA achieved by running ≥ 2 stateless site nodes.
- Measurement: external uptime probe against a public health endpoint.

**[NFR-SEC-004] Security (the 14 baselines — mandatory)**
1. UUID content IDs. 2. Public APIs published-only. 3. No user enumeration. 4. Per-block sanitization; raw HTML gated. 5. CSRF tokens enforced in SDK. 6. `sensitive` fields encrypted at rest, redacted in logs, separately gated. 7. Sealed secrets vault. 8. Append-only audit log. 9. TLS required in production. 10. Strict CSP with declared origins. 11. Plugin CVE feed; refuse known-vuln plugins. 12. Auth rate-limit + lockout. 13. Upload validation (magic-byte + type + extension + outside web root). 14. No raw DB access for plugins (gated `storage.raw`).

**[NFR-COMP-005] Compliance**
- Strict GDPR: Articles 5, 6, 7, 15, 17, 20, 30, 32 supported as first-class features (see FR-040…FR-043).
- Audit log retention configurable to meet records-of-processing obligations.

**[NFR-MAINT-006] Maintainability**
- Monorepo with clear package boundaries; framework-agnostic logic in `packages/*`, nothing security-relevant in `apps/*`.
- MTTR target ≤ 30 min for single-node restore from backup.
- CI must run typecheck, lint, unit/integration tests, dependency + secret scanning on every change.

**[NFR-PORT-007] Portability**
- Runs on any Linux host with Docker; no cloud-provider lock-in; storage backend swappable via adapter.

**[NFR-USE-008] Usability / Accessibility**
- Studio targets WCAG 2.1 AA for core authoring flows.
- A non-technical user can model a type, build a page, and publish without documentation beyond inline guidance.

### 3.3 External Interface Requirements

#### 3.3.1 User Interfaces
- **Studio (SPA):** dashboard, content list/editor, block page builder (drag-drop), content-type builder, media library, menu builder, form builder, theme customizer, users & roles, plugin manager, audit log viewer, GDPR tools, settings.
- **Site (SSR):** themed public pages, search, forms, cookie-consent banner.
- **Plugin panels:** sandboxed iframes embedded in Studio.

#### 3.3.2 API / Integration Interfaces
- **Admin API** (Studio): authenticated, CSRF-protected, capability-gated REST/RPC under `/admin/api/*`.
- **Public API** (Site): published-only read endpoints; `/api/p/<plugin>/<action>` dynamic plugin dispatch; `/sitemap.xml`, `/robots.txt`.
- **SDK (host + worker subpackages):** the only surface plugins import; semver'd.
- Conventions: JSON, UUID resource IDs, cursor pagination, uniform error envelope (no stack/PII leakage), versioned under `/v1`.

#### 3.3.3 Third-Party Services
- Reverse proxy/CDN (TLS, caching).
- SMTP provider (transactional mail).
- Optional S3-compatible object storage (media at scale).
- Optional managed database (Postgres/Mongo).
- Plugin CVE feed.

---

## 4. Appendices

### Appendix A — Use Case Descriptions (selected)

**UC-1: Editor publishes a page**
1. Editor logs in (FR-001) and opens a draft.
2. Edits blocks (FR-011); saves → revision created (FR-013).
3. Submits/publishes; capability `content.publish` checked (FR-003, FR-012).
4. Engine writes entry + revision, appends audit (FR-050), invalidates cache tag (FR-033).
5. Public URL resolves to the new version on next request (FR-030).

**UC-2: Admin installs a plugin**
1. Admin uploads a signed plugin bundle (FR-021).
2. System verifies signature; in prod, unsigned is rejected.
3. Studio displays requested capabilities; admin approves.
4. PluginHost loads the plugin in a worker (FR-022); endpoints become live (FR-024).

**UC-3: Data subject requests erasure**
1. Admin receives request and runs erasure tool (FR-041).
2. System cascades deletion, crypto-shreds sensitive fields, writes tombstone + audit entry.
3. Subsequent export shows no personal data for the subject.

**UC-4: Non-technical user models a new content type**
1. User opens content-type builder (FR-010).
2. Adds fields with types and validation; saves.
3. Type is immediately available for authoring; no redeploy (FR-030).

### Appendix B — Data Dictionary (core entities)
| Entity | Key fields |
|---|---|
| User | id (UUID), email, password_hash, mfa_enabled, status, created_at |
| Role | id, name, capabilities[] |
| ContentType | id (UUID), name, slug, fields[] |
| Field | id, type, name, required, validation, sensitive |
| ContentEntry | id (UUID), type_id, slug, status, author_id, locale, published_at |
| Revision | id (UUID), entry_id, version, blocks(JSON), editor_id, created_at |
| Media | id (UUID), filename, mime, size, checksum, path, created_at |
| Menu / MenuItem | id, items[] / id, label, target, parent_id, order |
| Form / FormSubmission | id, schema / id, form_id, data(JSON), consent, created_at |
| Plugin | id, name, version, capabilities[], signature, enabled |
| Secret | name, ciphertext, scope, created_at |
| AuditEntry | id, action, actor_id, detail(JSON), prev_hash, at |
| Session | id, user_id, expires_at, revoked |
| ConsentRecord | id, subject_ref, scope, granted, at |

### Appendix C — Glossary
See §1.3. Additional: **crypto-shred** — render data unrecoverable by destroying its encryption key; **tag cache** — cache keyed by content identity rather than time; **tombstone** — a marker recording that a record was erased while preserving referential integrity.
