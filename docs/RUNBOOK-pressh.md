# Operations Runbook — Pressh

**Status:** Approved · **Date:** 2026-05-20 · **Audience:** on-call / operators

> Written for an engineer who has never seen this system. Commands are illustrative; adjust paths/names to your deployment.

---

## System Overview
Pressh is a self-hosted, single-tenant CMS running as **two processes**:
- **Site** (public): Hono + Vite SSR. Stateless; horizontally scalable. Serves all non-`/admin` traffic.
- **Studio** (admin): Hono + Vite SPA. Single small node; deployable behind VPN/SSO/IP allowlist. Serves `/admin`.

Both read shared on-disk state (`/content`, `/media`, `/plugins`, vault file) and a SQLite index (or external DB via adapter). Plugins run in isolated worker threads per process. State lives in storage, not memory — any process can be restarted safely.

**Commerce (Inventory plugin):** when enabled, the store keeps all data — products, categories, the stock ledger,
orders, payments, returns — in plugin-owned collections within the shared store, so the standard backup/restore (below)
covers it. The public storefront serves orders/cart/checkout from the **Site** process. Customer order records contain
PII (name/email/address) — include `inventory_orders` in GDPR subject scopes and apply a retention policy.

**Boot dependencies (fail-closed):** `PRESSH_MASTER_KEY` must decrypt the vault; the audit log must be writable; in production, plugins must be validly signed (or `PRESSH_ALLOW_UNSIGNED=1`).

## Architecture Quick Reference
```
Internet → Reverse Proxy / TLS (Caddy/Nginx)
   ├── /admin (+IP allowlist) → Studio process → PluginHost → workers
   └── /* , /api               → Site process   → PluginHost → workers
Shared volume: /content  /media  /plugins  vault.bin   +  SQLite index (or external DB)
```
Full diagrams: `architecture-pressh-v1.html` → Diagrams.

## Monitoring & Alerting Reference
| Alert                                   | Meaning                            | Severity | First step                                                                                                      |
|-----------------------------------------|------------------------------------|----------|-----------------------------------------------------------------------------------------------------------------|
| Site health check failing               | Site process down/unresponsive     | SEV-2    | Check container status + logs; restart; CDN serves stale meanwhile                                              |
| SSR p99 > 400ms sustained               | Render slow / cache misses         | SEV-3    | Check cache hit ratio; warm cache; scale site nodes                                                             |
| Worker crash-loop (plugin X)            | A plugin keeps crashing            | SEV-3    | Disable/quarantine plugin; inspect worker logs                                                                  |
| Auth failure spike / lockouts           | Brute force or credential stuffing | SEV-2    | Confirm rate-limit firing; consider IP block at proxy; check audit log                                          |
| Disk > 85%                              | Content/media/log growth           | SEV-3    | Check media + audit growth; prune per retention; expand volume                                                  |
| Vault decrypt failure on boot           | Wrong/missing master key           | SEV-1    | Supply correct `PRESSH_MASTER_KEY`; do NOT rotate blindly                                                       |
| CVE-gate rejection on load              | Plugin flagged vulnerable          | SEV-3    | Verify CVE feed; update/remove plugin                                                                           |
| Audit write failure                     | Storage issue (ops fail closed)    | SEV-1    | Restore log writability; mutations are being rejected                                                           |
| Checkout error rate up / orders stalled | Storefront checkout failing        | SEV-2    | Confirm Inventory plugin enabled (`has('inventory')`); check worker logs; verify stock/settings; see playbook 6 |

**Tooling:** logs (pino JSON), metrics (Prometheus), traces (OpenTelemetry), audit log viewer in Studio.

## Deployment Procedures

### Standard deploy
```bash
# 1. Pull pinned images / checkout tagged release
# 2. Build the self-contained standalone bundle into .pressh/
#    (tsc typecheck → admin/panels → sign builtins → site client → esbuild bundle).
#    The Docker image does this in its build stage and ships ONLY .pressh/.
npm run build
# 3. Run DB/index migrations (idempotent)
pressh migrate
# 4. Roll Site nodes one at a time (proxy drains); then Studio. On boot the
#    container entrypoint re-signs the built-in plugins with this deployment's
#    PRESSH_MASTER_KEY (the image ships dev-key signatures) before starting.
docker compose up -d site
docker compose up -d studio
# 5. Verify
curl -fsS https://<host>/healthz && echo OK
```

### Upgrading to the non-root image (one-time)

The container now runs as the unprivileged `node` user (uid 1000), not root. A
**fresh** `pressh-data` volume comes up owned by `node` automatically. An
**existing** volume created by an older root-running image is owned by uid 0, so
the new process cannot write its secrets/content/vault and will fail to boot.
Chown the volume **once**, before rolling the new image:

```bash
docker compose down
docker run --rm -v pressh-data:/data busybox chown -R 1000:1000 /data
docker compose pull && docker compose up -d site studio
curl -fsS https://<host>/healthz && echo OK
```

Symptom if skipped: entrypoint logs `cannot create /data/secrets …` or the app
exits on a vault/storage write error. (No effect on fresh installs.)

### Rollback (standard)
```bash
# Re-deploy the previous tagged image; index/content are backward-compatible within a minor.
docker compose up -d --no-deps site studio   # previous tag
pressh migrate --down <version>              # only if a migration must be reverted
```

### Emergency rollback
1. Repoint proxy to the last-known-good image tag (fastest).
2. If data migration caused it: restore the pre-deploy backup (see DR), then redeploy old version.
3. Announce via comms template; open incident.

## Common Incident Playbooks

### 1. Plugin worker crash-loop
- **Symptom:** repeated "worker exited" for plugin X; affected blocks render fallback.
- **Diagnose:** `docker logs <site>` → filter plugin X; check recent install/upgrade; check CVE-gate.
- **Remediate:** In Studio → Plugins → disable X (revokes capabilities; host stops the worker). Site degrades gracefully. File issue with plugin author. Re-enable after fix.
- **Escalate:** if X is critical to the site, restore previous plugin version from backup.
- **Post:** confirm no capability abuse in audit log.

### 2. Public site 5xx spike
- **Symptom:** Site health/SSR errors rise.
- **Diagnose:** `curl /healthz`; check SSR p99 + cache hit %; check disk + index integrity; check a misbehaving plugin.
- **Remediate:** warm/rebuild cache; scale site nodes; if storage-bound, free disk / rebuild SQLite index (`pressh index:rebuild`); if a plugin is implicated, quarantine it.
- **Escalate:** SEV-2 if sustained > 10 min or revenue-impacting.

### 3. Suspected breach / anomalous capability use
- **Symptom:** unusual capability-denied/granted patterns, unexpected secret access, unknown plugin.
- **Diagnose:** query audit log (append-only, trustworthy) for actor, action, timeline.
- **Contain:** disable suspect plugin; revoke sessions; **rotate `PRESSH_MASTER_KEY`** (re-encrypts vault); block source IP at proxy.
- **Eradicate/Recover:** remove malicious plugin; restore from known-good backup if data integrity is in doubt.
- **Post:** blameless postmortem; reconstruct timeline from audit log; close control gap.

### 4. Auth brute force / credential stuffing
- **Diagnose:** auth-failure metric + audit log; identify source IPs/accounts.
- **Remediate:** confirm rate-limit + lockout active; block IPs at proxy/WAF; force-reset affected accounts; enable/require MFA.

### 5. Disk full / storage pressure
- **Diagnose:** `df -h`; identify growth (media vs audit vs revisions).
- **Remediate:** apply retention purge (`pressh gdpr:purge`, revision cap); offload media to object store; expand volume. Never delete the audit log manually (purges must be audited).

### 6. Storefront checkout failing / stock looks wrong

- **Symptom:** customers can't check out, orders stall in `pending`, or on-hand stock disagrees with the catalog.
- **Diagnose:** confirm the **Inventory** plugin is enabled (a disabled plugin makes `/api/p/inventory/*` 404 and
  product grids render their empty state); check the Site worker logs for the plugin; in Studio → Inventory → Stock,
  compare a variant's on-hand against its movement ledger (they must reconcile).
- **Remediate:** re-enable the plugin if off; checkout validates price + stock server-side, so a rejected checkout
  usually means genuinely insufficient stock — restock via Studio → Inventory → Stock (a `receive` movement). For an
  order placed but not captured, record/refund payment from the order detail (payments are recorded, not charged — no
  external gateway in v1). Cancelling an order restocks it through the ledger.
- **Escalate:** SEV-2 if checkout is down during a sale; the public site itself stays up (only the store widgets are
  affected).
- **Post:** confirm the stock ledger reconciles; check for any oversell (guarded server-side, but verify).

## Disaster Recovery Procedures
- **RTO:** ~15–30 min (single-node restore). **RPO:** ≤ 24h daily backups; ≤ 1h with hourly snapshots / DB WAL.
- **Posture:** active-passive. Nightly off-host backup of `/content`, `/media`, `vault.bin`, and DB (if used).

### Failover / restore steps
```bash
# 1. Provision a fresh host with Docker + the same release tag.
# 2. Restore data
pressh restore --from <backup-archive>     # content, media, vault, db
# 3. Supply secrets
export PRESSH_MASTER_KEY=...               # same key as the backed-up vault
# 4. Rebuild derived index if needed (idempotent)
pressh index:rebuild
# 5. Start, verify, repoint DNS/proxy
docker compose up -d
curl -fsS https://<host>/healthz
```
- **Data recovery (partial):** restore a single content tree/media set from the archive without a full restore.
- **Comms template:** "We are investigating an issue affecting <scope> beginning <time>. Next update in <interval>." Update on cadence until resolved; follow with a postmortem.

### Scheduled backups (automated)

Set these on the **Studio** process to enable recurring backups (the Site has no scheduler, so backups never
double-run):

- `PRESSH_BACKUP_DIR` — destination directory. **Point it at a mounted offsite volume** (NFS, a separate disk, or an
  `rclone`/S3 FUSE mount) to get true offsite copies with no extra dependency. Created `0700`; it holds the vault +
  audit log, so keep it on restricted/encrypted storage and never expose it over HTTP.
- `PRESSH_BACKUP_INTERVAL_MS` — interval between runs (default `86400000` = 24h).
- `PRESSH_BACKUP_KEEP` — how many timestamped backups to retain (default `7`); older ones are pruned automatically.

Each run writes `PRESSH_BACKUP_DIR/backup-<ISO>/` (content, media, vault, audit) and the job re-schedules the next run,
forming a single recurring chain that survives restarts. Operators with `backups.manage` (Owner/Admin) manage this from
**Studio → System → Backups**: see the schedule, **Back up now**, and **Run restore drill** (restores the latest backup
into a throwaway sandbox and reports per-collection record counts — proving the backup is restorable without touching
live data). Failures and manual runs are audited (`backup.run` / `backup.failed` / `backup.verify`).

**Native cloud target (S3/GCS):** scheduled backups use a pluggable `BackupTarget` (`@pressh/core`). The filesystem
target ships in core; a cloud target is a drop-in implementing the same `store`/`list` shape (kept out of core to avoid
bundling a cloud SDK + credential surface). For most self-hosters, `PRESSH_BACKUP_DIR` on a mounted offsite volume is
the recommended path.

## Maintenance Procedures
- **Database / index migrations:** `pressh migrate` (idempotent, forward); test on a restored backup first; index rebuild is always safe (derived from canonical files).
- **Switching the storage backend (Database Manager):** Studio → **Database** changes the active store (File → SQLite /
  PostgreSQL / MySQL / MongoDB). The flow is, in order: test the target connection → put the public Site into
  maintenance mode (HTTP 503) → copy every record → verify per-collection counts → snapshot the old store to
  `<data>/backups/pre-migration-<ts>` → write `<data>/storage.json` and clear maintenance on the new store → **both
  processes exit and the supervisor restarts them on the new backend** → the old store is removed (a
  `<data>/storage.json.previous` marker drives this after the restart; the backup is retained).
    - **Prerequisites:** `PRESSH_MASTER_KEY` must be set on **both** Studio and Site (the connection string is sealed in
      the vault), and a process supervisor must auto-restart on clean exit (compose `restart: unless-stopped`, systemd
      `Restart=always`, or pm2). The target database must be empty.
    - **Expected downtime:** a maintenance window of a few seconds to minutes (proportional to data size) plus one
      restart blip on each process.
    - **If it fails before cutover:** nothing changes — maintenance mode is lifted, the lock is released, and the app
      keeps serving the current store. Re-check the target connection and retry.
    - **Rollback after cutover:** restore the retained `pre-migration-<ts>` backup over `<data>` (or delete
      `storage.json` to fall back to the filesystem) and restart. The pre-cutover store/backup is kept until you
      explicitly remove it (Studio prompts, or it auto-removes only when you opted in).
- **Certificate rotation:** managed at the proxy (Caddy auto-renews; Nginx via your ACME tooling). Pressh requires TLS in prod — verify after rotation.
- **Master key rotation:** `pressh vault:rotate` re-encrypts all secrets under a new `PRESSH_MASTER_KEY`; keep the old key until rotation completes; back up the vault first.
- **Dependency updates:** bump pinned versions on a branch; CI must pass (typecheck, tests, dependency/secret/SAST scan); deploy via standard procedure.
- **Plugin updates:** review requested capability changes on upgrade; signature re-verified; CVE-gate re-checked.

## Contact Directory & Escalation Matrix
| Role | Responsibility | Escalate when |
|---|---|---|
| On-call engineer | First response, triage, SEV-3 resolution | Always first |
| Eng lead | SEV-2 coordination, deploy/rollback calls | SEV-2+, or > 30 min unresolved |
| Security lead | Breach response, key rotation, pentest | Any suspected breach (SEV-1/2) |
| Product owner | Comms, scope/priority calls | Customer-visible SEV-1/2 |
| Ops/Infra | Host, storage, proxy, DNS | Infra-rooted incidents |

> Replace roles with named contacts and an escalation channel for your deployment.
