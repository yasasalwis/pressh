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
npm run build
npm run tests
```

Start both apps with a single command (Studio on port 4000, Site on port 3000):

```bash
npm start
```

Need just one process? Use `npm run studio` or `npm run site` (build first with `npm run build`).

Open Studio at `http://localhost:4000` to create your first content type.

---

## Deployment

Pressh is a **long-running, stateful server** — not a serverless app. It needs a host that
runs persistent Node processes and a **persistent disk**. Serverless platforms (Vercel,
Netlify Functions, Cloudflare Workers) are not supported: the plugin runtime relies on
long-lived worker threads, and content, media, and the audit log are written to disk.

Every deployment target below shares the same three requirements:

**1. Two processes, one trust boundary (ADR-002).** Site (`:3000`, public) and Studio
(`:4000`, admin) run as separate processes. **Studio must never be reachable from the public
internet** — firewall the port and/or front it with a reverse proxy + IP allowlist.

**2. A persistent `/data` volume.** Content, uploaded media, and the audit log live on disk
under `PRESSH_CONTENT_ROOT` and `PRESSH_MEDIA_ROOT`. Both processes share it. Back it up.

**3. Two secrets, generated once.** Required when `NODE_ENV=production`:

```bash
# Run twice — once for each secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```env
PRESSH_MASTER_KEY=<32-byte hex>   # seals the secrets vault (AES-256-GCM)
PRESSH_CSRF_SECRET=<32-byte hex>  # signs CSRF tokens
```

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | `production` enforces TLS, signed plugins, and the master key | `development` |
| `PRESSH_MASTER_KEY` | Encryption-vault seal (**required in prod**) | — |
| `PRESSH_CSRF_SECRET` | CSRF token signing (**required in prod**) | — |
| `PRESSH_CONTENT_ROOT` | Content + audit log directory | `./data/content` |
| `PRESSH_MEDIA_ROOT` | Uploaded media directory | `./data/media` |
| `PRESSH_SITE_PORT` | Public site port | `3000` |
| `PRESSH_STUDIO_PORT` | Admin studio port | `4000` |

Both processes expose `GET /healthz` (liveness) and `GET /readyz` (readiness) for health checks.

---

### Option A — Self-hosted, no Docker

For a VM or bare-metal host with Node.js 24+ installed.

```bash
git clone https://github.com/your-org/pressh.git
cd pressh

npm ci
npm run build          # signs built-in plugins, compiles, bundles the site
```

Export the environment and storage roots, then start both processes:

```bash
export NODE_ENV=production
export PRESSH_MASTER_KEY=<32-byte hex>
export PRESSH_CSRF_SECRET=<32-byte hex>
export PRESSH_CONTENT_ROOT=/var/lib/pressh/content
export PRESSH_MEDIA_ROOT=/var/lib/pressh/media

npm start              # launches Site (:3000) and Studio (:4000) together
```

For production, run each process under `systemd` so they restart on failure and survive
reboots. Create `/etc/pressh.env` with the variables above, then two units:

```ini
# /etc/systemd/system/pressh-site.service
[Unit]
Description=Pressh Site (public)
After=network.target

[Service]
WorkingDirectory=/opt/pressh
EnvironmentFile=/etc/pressh.env
ExecStart=/usr/bin/node apps/site/dist/server.js
Restart=on-failure
User=pressh

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/pressh-studio.service
[Unit]
Description=Pressh Studio (admin)
After=network.target

[Service]
WorkingDirectory=/opt/pressh
EnvironmentFile=/etc/pressh.env
ExecStart=/usr/bin/node apps/studio/dist/server.js
Restart=on-failure
User=pressh

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now pressh-site pressh-studio
```

Front the **site** with a reverse proxy for TLS (Caddy auto-provisions certificates):

```caddy
yourdomain.com {
    reverse_proxy localhost:3000
}
```

Keep **Studio off the public internet** — do not proxy port 4000. Reach it over a VPN, an
SSH tunnel (`ssh -L 4000:localhost:4000 host`), or a reverse proxy locked to your office IP.

---

### Option B — Self-hosted with Docker

The repo ships a [`Dockerfile`](./Dockerfile) and [`docker-compose.yml`](./docker-compose.yml)
that run Site and Studio as two services sharing a named volume. This is the simplest
production setup on a single host.

```bash
cp .env.example .env     # fill in PRESSH_MASTER_KEY and PRESSH_CSRF_SECRET

docker compose up -d --build
```

| Service | Port | Exposure |
|---|---|---|
| `site` | `3000` | Published to the host |
| `studio` | `4000` | `expose`d on the internal network only — **not** published |

The compose file mounts a `pressh-data` volume at `/data` for both services and sets
`NODE_ENV=production`. Studio is intentionally not port-mapped to the host; put a reverse
proxy + IP allowlist in front of it before exposing it anywhere (see
[`RUNBOOK-pressh.md`](docs/RUNBOOK-pressh.md)).

Health, logs, and shutdown:

```bash
docker compose ps                  # health status of both services
docker compose logs -f site        # follow site logs
docker compose down                # stop (volume is preserved)
```

---

### Option C — Railway

Railway gives the closest push-to-deploy experience while keeping the architecture intact.
Run **both processes in one service** with a single attached volume — Railway volumes bind to
one service, so this preserves the shared `/data` disk.

1. **New Project → Deploy from GitHub repo**, select this repo. Railway detects the
   [`Dockerfile`](./Dockerfile) and builds from it.
2. **Settings → Deploy → Custom Start Command:** `node scripts/run.mjs`
   (launches Site and Studio together).
3. **Variables:** add `NODE_ENV=production`, `PRESSH_MASTER_KEY`, `PRESSH_CSRF_SECRET`,
   `PRESSH_CONTENT_ROOT=/data/content`, `PRESSH_MEDIA_ROOT=/data/media`,
   and `PRESSH_SITE_PORT=3000`.
4. **Storage → Add Volume**, mount path `/data`.
5. **Settings → Networking:** generate a public domain and set the target port to `3000`
   (the public site). Leave Studio's `4000` unpublished — reach it via Railway private
   networking or a TCP proxy locked down to you.
6. Set the healthcheck path to `/healthz`.

> Note: a single Railway volume cannot be shared across two separate services, so the
> two-process split runs as two processes inside one container here rather than two
> containers. The trust boundary (Studio not publicly routed) is still enforced.

---

### Option D — Hetzner (VPS)

A Hetzner Cloud server (or any VPS) running the Docker setup from **Option B**, hardened with
a firewall and TLS.

```bash
# On a fresh Ubuntu/Debian server, as root or with sudo:
apt-get update && apt-get install -y docker.io docker-compose-plugin git
git clone https://github.com/your-org/pressh.git /opt/pressh
cd /opt/pressh
cp .env.example .env     # fill in the two secrets

docker compose up -d --build
```

Lock down the firewall so only the public site and SSH are reachable — **block Studio's port**:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 4000/tcp        # Studio: never public
ufw enable
```

Terminate TLS with a reverse proxy on the host (Caddy shown; nginx works too):

```caddy
yourdomain.com {
    reverse_proxy localhost:3000
}
```

Reach Studio over an SSH tunnel from your machine, keeping it entirely off the public net:

```bash
ssh -L 4000:localhost:4000 user@your-server   # then open http://localhost:4000
```

For backups, snapshot the `pressh-data` Docker volume (or the Hetzner block volume backing
it) on a schedule, and store snapshots off-host. See
[`RUNBOOK-pressh.md`](docs/RUNBOOK-pressh.md) for backup/restore procedures.

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

### Built-in plugins

Pressh ships five first-party plugins in `builtins/` — same security model as any plugin (own worker, declared capabilities, signed at build). **All ship disabled**; enable only what you need from **Studio → Plugins** so the app stays lean. A disabled plugin spawns no worker at all.

| Plugin | What it does | Capabilities |
|---|---|---|
| **DB** (Data Manager) | Read-only data browser + JSON export. No raw queries. | `storage.read:*` |
| **Inventory** | Product/stock CRUD; public listing at `GET /api/p/inventory/items`. | `storage.read/write:inventory_items` |
| **Forms** | Submissions → `form_submissions` (GDPR-linked); honeypot + per-IP rate limit. | `storage.read/write:form_submissions` |
| **SEO** | Per-page + site meta/OpenGraph tags injected into the public `<head>`. | `storage.read/write:seo_meta` |
| **Analytics** | Cookieless server-side page-view counts. No cookies, IPs, or third parties. | `storage.read/write:analytics_daily` |

Auth-critical collections (`users`, `sessions`, `invites`) are off-limits to every plugin. Re-run `npm run sign:builtins` after editing a built-in's code (it also runs as part of `npm run build`).

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
npm run tests

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
