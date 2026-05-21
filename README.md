# Pressh

**Secure-by-default, no-code, self-hosted CMS — built for the post-WordPress era.**

Pressh is a TypeScript-native content management system that treats security as a first-class architectural concern, not an afterthought. Every plugin runs in an isolated worker thread. Every capability is denied by default. Every mutation lands in an immutable audit log. No PHP. No RCE surface.

---

## Why Pressh?

WordPress powers 43% of the web and is responsible for a disproportionate share of CMS-related breaches. The failure modes are structural: plugins execute in-process with full application privileges, SQL queries are hand-rolled across thousands of third-party packages, and the admin UI is reachable from the same domain as public content.

Pressh eliminates each of these by design:

| WordPress failure mode | Pressh mitigation |
|---|---|
| Plugin RCE (in-process execution) | All plugins run in sandboxed Node worker threads |
| SQL injection via plugin code | Parameterized adapters; plugins have no DB access |
| Admin credential brute-force | Argon2id + rate-limit + account lockout |
| File-upload RCE | MIME validation + strict type allowlist |
| REST user enumeration | No public user endpoints |
| XSS via rich-text fields | sanitize-html on every block save |
| CSRF on admin mutations | Cryptographic CSRF tokens, enforced centrally |

---

## Feature Overview

- **Visual content modeling** — define custom content types with 10+ field types (text, rich text, number, boolean, date, media, reference, repeater, select, sensitive)
- **Block-based page builder** — drag-and-drop block composition with sanitized XSS-safe rendering
- **Content workflow** — Draft → In Review → Scheduled → Published → Archived state machine with role-gated transitions
- **Immutable revision history** — every save creates a timestamped, restorable snapshot
- **Multi-user roles** — Owner, Admin, Editor, Author, Viewer with granular capability gating
- **Plugin system** — TypeScript-native plugins with declarative capability manifests, isolated in worker threads
- **i18n** — per-locale content variants out of the box
- **GDPR-native** — data-subject export, erasure, consent tracking, and retention policies built into v1
- **Observability** — structured Pino logging (with redaction), Prometheus metrics, request-ID tracing, immutable audit log
- **Flexible storage** — filesystem + SQLite by default; swap to PostgreSQL or MongoDB via adapter
- **Two-process architecture** — Studio (admin) and Site (public) run as separate OS processes; compromise of the public site cannot touch admin data

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Monorepo                                                   │
│                                                             │
│  packages/                                                  │
│    @pressh/core     ← auth, storage, capabilities, audit   │
│    @pressh/engine   ← content types, blocks, workflow      │
│    @pressh/sdk      ← plugin types & RPC protocol          │
│    @pressh/runtime  ← plugin host, worker isolation        │
│    @pressh/ui-kit   ← shared UI components                 │
│                                                             │
│  adapters/                                                  │
│    @pressh/adapter-sqlite    ← default (embedded)          │
│    @pressh/adapter-postgres  ← external Postgres           │
│    @pressh/adapter-mongo     ← MongoDB                     │
│                                                             │
│  apps/                                                      │
│    @pressh/site    :3000 ← public-facing, SSR              │
│    @pressh/studio  :4000 ← admin CMS (internal only)      │
└─────────────────────────────────────────────────────────────┘
```

**Two-process trust split:** Studio and Site are independent server processes sharing only a volume. In production, Studio should never be reachable from the public internet.

**Plugin isolation model:**

```
Studio process
  └── PluginHost
        └── Worker thread (plugin code)
              ↕  structured RPC over parentPort
              capability gate checks on every call
              sandboxed iframe for plugin UI
```

Plugins declare their capabilities in `pressh.plugin.json`. Any call beyond the granted set is rejected before execution.

---

## Getting Started

### Prerequisites

- Node.js 24+
- Docker (optional, for containerized deployment)

### Local development

```bash
git clone https://github.com/your-org/pressh.git
cd pressh

npm ci
npm run build:packages
npm test
```

Start both apps:

```bash
# Terminal 1 — Studio (admin, port 4000)
npm run dev --workspace=apps/studio

# Terminal 2 — Site (public, port 3000)
npm run dev --workspace=apps/site
```

Open Studio at `http://localhost:4000` to create your first content type.

### Docker (recommended for production)

```bash
# Copy and fill in the required secrets
cp .env.example .env

docker compose up
```

| Service | Port | Exposure |
|---|---|---|
| Site | 3000 | Public |
| Studio | 4000 | **Internal only** — firewall before deploying |

Required secrets:

```env
PRESSH_MASTER_KEY=<32-byte hex>   # Derives all encryption keys
PRESSH_CSRF_SECRET=<32-byte hex>  # CSRF token signing
```

Generate them with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Storage Configuration

Pressh defaults to filesystem storage with a SQLite index — no external database required.

| Adapter | Config | When to use |
|---|---|---|
| Filesystem + SQLite | *(default)* | Single-server, small–medium sites |
| PostgreSQL | `PRESSH_DB_URL=postgres://...` | High-concurrency, horizontal scaling |
| MongoDB | `PRESSH_DB_URL=mongodb://...` | Document-heavy content models |

All adapters implement the same `StorageAdapter` interface and pass the shared conformance test suite.

---

## Plugin Development

1. Create a plugin directory with a manifest:

```json
// my-plugin/pressh.plugin.json
{
  "id": "my-plugin",
  "version": "1.0.0",
  "entrypoint": "./handler.js",
  "capabilities": ["storage.read:posts", "network.fetch:api.example.com"],
  "adminPanel": "./panel.html"
}
```

2. Implement the handler using the SDK:

```typescript
import type { PluginManifest, HostApi } from "@pressh/sdk";

export async function handle(args: unknown, host: HostApi): Promise<unknown> {
  const posts = await host.storage.list("posts");
  return { count: posts.length };
}
```

3. Drop the plugin folder into `plugins/` — Pressh loads it on next restart.

Capabilities not listed in the manifest are rejected at the RPC boundary. The admin panel runs in a sandboxed iframe; it cannot touch the host DOM or parent window.

---

## Security Baselines

Pressh ships with 14 security baselines enforced by `tests/security-baselines.test.ts`:

1. Argon2id password hashing (no MD5/bcrypt/SHA-1)
2. CSRF tokens on all admin mutations
3. Rate limiting + account lockout on login
4. Worker-thread plugin isolation (no `eval`, no `vm.runInThisContext`)
5. Default-deny capability gate
6. Sanitize-html on all rich-text block saves
7. MIME-type allowlist on media uploads
8. No public user-enumeration endpoints
9. Immutable audit log (append-only, no delete API)
10. Strict Content-Security-Policy headers
11. CVE feed checked at plugin load time
12. Session expiry + rotation on privilege change
13. Secrets encrypted at rest via master-key derivation
14. Studio port never referenced from Site process

---

## Testing

```bash
# All tests
npm test

# Single package
npm test --workspace=packages/engine

# Security baselines only
npx vitest run tests/security-baselines.test.ts

# E2E
npx vitest run tests/e2e.test.ts
```

The adapter conformance suite (`adapters/conformance.ts`) runs against all three backends — SQLite, PostgreSQL, and MongoDB — to guarantee identical behaviour across storage layers.

---

## CI/CD

GitHub Actions runs on every push to `main`/`dev` and all PRs:

| Job | Steps |
|---|---|
| **build-and-test** | `npm ci` → `build:packages` → `test` → `lint` |
| **security** | `npm audit --audit-level=high` → SBOM (CycloneDX) → secret scanning |

---

## Observability

| Signal | Where |
|---|---|
| Structured logs | stdout (Pino JSON); sensitive keys auto-redacted |
| Prometheus metrics | `GET /metrics` on both apps |
| Health check | `GET /healthz` |
| Readiness check | `GET /readyz` |
| Audit log | Append-only file at `$PRESSH_CONTENT_ROOT/audit.log` |

---

## Operations

### Backup and restore

```bash
# Create a backup
node apps/studio/dist/cli.js backup --out ./backups/$(date +%Y%m%d).tar.gz

# Restore
node apps/studio/dist/cli.js restore --file ./backups/20260101.tar.gz
```

### GDPR requests

```bash
# Export all data for a subject
node apps/studio/dist/cli.js gdpr export --subject user@example.com

# Erase all data for a subject
node apps/studio/dist/cli.js gdpr erase --subject user@example.com
```

---

## Documentation

Full design and architecture documents live in [`docs/`](./docs/):

| Document | Description |
|---|---|
| [`SRS-pressh.md`](docs/SRS-pressh.md) | Software Requirements Specification (80+ requirements) |
| [`TDD-pressh.md`](docs/TDD-pressh.md) | Technical Design Document |
| [`SAD-pressh.md`](docs/SAD-pressh.md) | Security Architecture Document + threat model |
| [`ADRs-pressh.md`](docs/ADRs-pressh.md) | Architecture Decision Records (11 ADRs) |
| [`RUNBOOK-pressh.md`](docs/RUNBOOK-pressh.md) | Operations guide (deploy, scale, backup, troubleshoot) |
| [`SDR-pressh.md`](docs/SDR-pressh.md) | Security Design Review + control verification matrix |
| [`IMPLEMENTATION-pressh.md`](docs/IMPLEMENTATION-pressh.md) | Phase-by-phase build guide |
| [`architecture-pressh-v1.html`](docs/architecture-pressh-v1.html) | Interactive architecture dashboard |

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 (ES modules) |
| Language | TypeScript 6.0 (strict) |
| HTTP framework | Hono 4.12 |
| Build | Vite 8.0 |
| Testing | Vitest 4.1 |
| Password hashing | Argon2id |
| Schema validation | Zod 4.4 |
| Logging | Pino 9.0 |
| Default storage | Filesystem + better-sqlite3 12 |
| Containers | Docker + Compose |

---

## License

MIT
