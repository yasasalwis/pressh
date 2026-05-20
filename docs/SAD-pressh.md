# Security Architecture Document — Pressh

**Status:** Approved · **Date:** 2026-05-20
**Audience:** security team, auditors, senior engineers.

> Pressh's reason to exist is security. This document is the authoritative description of the threat model and controls. Where the rest of the suite optimizes for clarity, this one optimizes for "what stops the data from leaking."

---

## 1. Security Objectives & Guiding Principles
**Objectives**
1. Eliminate WordPress's data-leakage classes: plugin RCE, SQLi in plugin code, IDOR, user enumeration, file-upload RCE, in-process secret exposure.
2. Contain any single compromise (plugin, process) without lateral reach.
3. Make secure behavior the *default and unavoidable* path for extension authors.
4. Provide tamper-evident accountability and GDPR data-subject guarantees.

**Principles**
- **Default deny** everywhere; least privilege via capabilities.
- **Plugins are untrusted, uniformly** — no privileged tier, no in-tree execution.
- **Security in core, not in author discipline** — CSRF, sanitization, UUIDs, capability checks are centralized.
- **Fail closed** — vault/audit/auth failures reject rather than degrade open.
- **Defense in depth** across edge → network → identity → app → data → supply chain.

---

## 2. Threat Model

### 2.1 Assets to Protect
- **Content & PII:** entries, users, form submissions, consent records.
- **Secrets:** API keys, SMTP creds, the master key, session secrets.
- **Integrity & availability** of the public site and admin.
- **Audit trail** (its own integrity).
- **Reputation:** the product's entire premise is "data doesn't leak."

### 2.2 Threat Actors
- **External attacker** — probes public endpoints, uploads, auth.
- **Malicious/compromised plugin or theme** — the primary modeled adversary.
- **Malicious insider / over-privileged user** — abuses granted access.
- **Supply-chain attacker** — tampered or vulnerable dependency/plugin.
- **Curious/abusive authenticated user** — privilege escalation, IDOR.

### 2.3 STRIDE Analysis
| # | Threat | STRIDE | Likelihood | Impact | Mitigation |
|---|---|---|---|---|---|
| 1 | Plugin executes arbitrary host code | Elevation | H | H | Worker-thread isolation; host never imports plugin code; RPC-only |
| 2 | Plugin reads data beyond grant | Info Disclosure | M | H | Default-deny capability gate on every RPC |
| 3 | IDOR via guessable IDs | Info Disclosure | M | M | UUID v4 IDs; published-only public scope |
| 4 | User enumeration on public API | Info Disclosure | H | M | No user data publicly; uniform 401/404 responses |
| 5 | Stored XSS via block content | Tampering | H | H | Per-block sanitization; raw HTML gated; strict CSP |
| 6 | CSRF on admin mutations | Tampering | M | H | CSRF tokens enforced in SDK (cannot be omitted) |
| 7 | File-upload RCE / polyglot | Elevation | M | H | Magic-byte + content-type + extension whitelist; stored outside web root; served via controlled route |
| 8 | Secret theft from memory/env | Info Disclosure | M | H | Sealed AES-256-GCM vault; scoped tokens by name; never `process.env` to plugins |
| 9 | Plugin admin UI steals session | Spoofing | M | H | Iframe sandbox (allow-scripts allow-forms); no same-origin cookie access; postMessage only |
| 10 | Credential stuffing / brute force | Spoofing | H | M | Rate limit + lockout + argon2id |
| 11 | Audit-history tampering | Repudiation | L | M | Append-only, hash-chained log; write fail = op fail |
| 12 | Known-vulnerable plugin installed | Elevation | M | H | CVE feed; refuse flagged plugins; signature required in prod |
| 13 | Plugin DoS (loop / memory bomb) | DoS | M | M | Per-worker CPU/timeout + memory caps; kill+restart |
| 14 | SQL injection in plugin code | Tampering/Info | M | H | No raw DB access; `storage.raw` gated; parameterized adapter APIs |
| 15 | Session fixation/hijack | Spoofing | M | H | httpOnly/Secure/SameSite cookies; rotate on login; TLS-only |
| 16 | SSRF via plugin network calls | Info Disclosure | M | M | Egress restricted to manifest-declared origins; deny by default |
| 17 | Public→admin lateral movement | Elevation | L | H | Two-process trust split; separate worker pools; admin allowlist |
| 18 | Mass assignment / over-posting | Tampering | M | M | Zod schemas; explicit field allowlists |

### 2.4 Attack Surface Map
- **Public Site:** front-controller URLs, `/api/p/*` dispatcher, media route, forms, sitemap/robots.
- **Studio:** `/admin/api/*`, login, upload, plugin install, iframe panels.
- **Plugin boundary:** the SDK RPC channel (the *only* path host↔plugin).
- **Storage:** filesystem/DB, vault file, audit log.
- **Supply chain:** plugin bundles, npm dependencies, base images.

---

## 3. Security Controls by Layer

### 3.1 Edge (WAF, DDoS, CDN)
- TLS-only with HSTS; reverse proxy terminates TLS.
- CDN absorbs cached traffic; optional WAF and edge rate-limiting.
- Admin path protectable by IP allowlist / VPN / SSO at the proxy.

### 3.2 Network (segmentation, egress)
- Studio and Site on separate processes; studio can live in a private subnet.
- App process ports internal-only; only the proxy is internet-facing.
- **Egress filtering:** plugin network access limited to manifest-declared origins (SSRF defense).

### 3.3 Identity & Access (AuthN, AuthZ, MFA, RBAC)
- argon2id hashing; optional TOTP MFA; session cookies httpOnly/Secure/SameSite, rotated on login, server-revocable.
- RBAC roles → capabilities; **server-side capability gate is authoritative**; UI never enforces.
- Rate-limit + account lockout on auth.

### 3.4 Application (OWASP Top 10)
- **Injection:** Zod validation at boundaries; no raw DB to plugins; parameterized adapter queries.
- **XSS:** per-block sanitization; raw HTML behind capability; strict CSP (`default-src 'self'`, declared origins, no inline without nonce).
- **CSRF:** tokens enforced centrally in the SDK.
- **Broken access control:** capability gate on every privileged op; published-only public scope; UUIDs.
- **Insecure deserialization:** structured-clone RPC only; no `eval`/dynamic require of plugin code in host.
- **Security misconfig:** secure defaults, prod refuses unsigned plugins, TLS enforced.

### 3.5 Data (classification, encryption, masking)
- Classify fields; `sensitive: true` → AES-256-GCM at rest, redacted in logs, separate capability to read.
- UUID IDs; published-only scoping; crypto-shred on erasure.
- Backups encrypted; media stored outside web root.

### 3.6 Supply Chain (SBOM, pinning, signing)
- Dependencies pinned (exact versions); SBOM generated in CI.
- Dependency vulnerability + secret scanning in CI.
- Plugins signed (`pressh.signature.json`); prod requires valid signature.
- CVE feed sync; host refuses to load known-vulnerable plugins.
- Base images pinned and scanned; images signed in CI/CD.

### 3.7 Incident Detection & Response
- Audit log + metrics feed detection (anomalous capability use, auth-failure spikes, worker crash loops).
- Response playbooks in RUNBOOK-pressh.md (breach, crash-loop, 5xx spike).
- Containment levers: revoke plugin capabilities, kill worker, rotate `PRESSH_MASTER_KEY` + sessions, restore from backup.

---

## 4. Compliance Mapping (GDPR)
| Requirement | Article | Control |
|---|---|---|
| Right of access | 15 | `GdprService.export(subject)` — all keyed records, machine-readable |
| Right to erasure | 17 | `GdprService.erase(subject)` — cascade + crypto-shred + audited tombstone |
| Data portability | 20 | JSON export, importable schema |
| Lawful basis / consent | 6, 7 | Consent manager + cookie banner; consent state stored & audited |
| Records of processing | 30 | Append-only audit log of mutations & access |
| Storage limitation | 5(1e) | Configurable retention + scheduled, audited purge |
| Security of processing | 32 | Encryption in transit/at rest + the full threat model above |

---

## 5. Security Testing Plan
### 5.1 SAST / DAST
- SAST on every PR (typed, lint+security rules); DAST against a staging Site for the public surface.
### 5.2 Penetration Testing
- Pre-1.0 external pentest scoped to: plugin isolation escape, capability bypass, upload RCE, auth, CSRF, IDOR. Re-test annually and on major plugin-boundary changes.
### 5.3 Dependency & Image Scanning
- CI fails on high/critical CVEs in dependencies or base images; SBOM archived per build.
### 5.4 Secrets Scanning
- Pre-commit + CI secret scanning; `.env` never committed; master key only via env/secret manager.
### 5.5 Targeted Security Tests
- Sanitizer fuzzed with an XSS payload corpus.
- Capability-denial tests for each capability.
- Worker-escape attempts (access host globals, other plugins, raw env) must fail.
- Upload tests with polyglots/disguised executables must be rejected.

---

## 6. Security Monitoring & Alerting
### 6.1 Key Metrics / SLIs
- Auth failure rate & lockouts; capability-denied rate; worker restarts/crash-loops; upload rejections; CSP violation reports; CVE-gate rejections; vault access rate.
### 6.2 SIEM Integration
- Structured logs + audit log shippable to a SIEM; correlation IDs across proxy→app→worker.
### 6.3 Incident Response Playbook (outline)
1. **Detect** (alert/audit anomaly) → 2. **Triage** severity → 3. **Contain** (revoke capability, kill worker, allowlist, rotate keys) → 4. **Eradicate** (remove plugin/patch) → 5. **Recover** (restore from known-good backup) → 6. **Post-incident** (timeline from audit log, blameless postmortem, control gap fixes). Full steps in RUNBOOK-pressh.md.
