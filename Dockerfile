# Pressh — single image, two entrypoints (site / studio). ADR-002 trust split.
#
# Built as a self-contained standalone bundle: `npm run build` produces `.pressh/`
# (the server bundles, signed builtins, native sqlite driver and worker runtime),
# and the runtime stage ships ONLY that folder — no source tree, no dev deps, no
# package manager. This is the Next.js `.next/standalone` model: a small image
# whose deps are already inlined into the bundles.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY adapters ./adapters
COPY apps ./apps
COPY scripts ./scripts
COPY builtins ./builtins
# `npm ci` compiles better-sqlite3 against this image's Node ABI (linux/node24);
# `npm run build` then bundles the apps and copies that native driver into
# .pressh/node_modules, so the runtime stage needs no toolchain or rebuild.
RUN npm ci && npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Memory/CPU tuning for small VMs (target: a 512 MB box without throttling).
# Each of the two processes (site + studio) runs in its own container and gets
# these. --max-old-space-size forces V8 to GC at ~112 MB instead of letting the
# heap grow until the kernel OOM-kills the process; with two processes that caps
# their combined heap near ~224 MB, leaving headroom for plugin workers + RSS.
# MALLOC_ARENA_MAX trims glibc's per-thread arena bloat (a classic RSS win for
# threaded Node), and UV_THREADPOOL_SIZE shrinks the libuv pool — better-sqlite3
# is synchronous and argon2 runs single-lane, so the default 4 threads is waste.
# Override NODE_OPTIONS (e.g. larger heap) on roomier hosts.
ENV NODE_OPTIONS="--max-old-space-size=112 --max-semi-space-size=16" \
    MALLOC_ARENA_MAX=2 \
    UV_THREADPOOL_SIZE=2
# Ship ONLY the standalone build, flattened so /app IS the `.pressh/` folder:
#   /app/{site,studio}/server.js, /app/builtins, /app/plugins,
#   /app/node_modules (native sqlite), /app/sign-builtins.mjs, /app/package.json
COPY --from=build /app/.pressh ./
# The entrypoint is the only non-bundle file the runtime needs.
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
# Per-process plugin dirs + worker sandbox. The default CMD is the public site,
# so the worker script defaults to the site's; the studio service overrides both
# `command` and PRESSH_WORKER_SCRIPT in docker-compose. Keeping each worker in its
# own runtime/ dir scopes the plugin sandbox's fs-read grant to a code-only dir.
ENV PRESSH_BUILTINS_DIR=/app/builtins \
    PRESSH_PLUGINS_DIR=/app/plugins \
    PRESSH_WORKER_SCRIPT=/app/site/runtime/worker-entry.js
# Run as the unprivileged `node` user (uid 1000) shipped in the base image,
# never root. The plugin worker sandbox + capability model are the primary
# isolation, but dropping privileges here means even a worst-case host-side
# file-write bug is confined to the app/data dirs instead of owning the host.
# Two dirs must therefore be writable by `node`:
#  - /app/builtins: the entrypoint re-signs the first-party plugins with this
#    deployment's master key on boot (the image ships dev-key signatures).
#  - /data: holds the auto-provisioned secrets, content, media and vault. A
#    FRESH named volume inherits the mountpoint's ownership, so creating /data
#    here owned by `node` makes the volume come up writable. (An EXISTING volume
#    from an older root image needs a one-time `chown -R 1000:1000` — see RUNBOOK.)
RUN chmod +x /app/docker-entrypoint.sh \
 && mkdir -p /data \
 && chown -R node:node /data /app/builtins
USER node
# `site` (public) and `studio` (admin) are started via docker-compose with
# different commands. Defaults to the public site.
EXPOSE 3000 4000
# The entrypoint provisions PRESSH_MASTER_KEY/CSRF on first boot (see the script)
# then exec's the command below (or the docker-compose `command:` override).
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "/app/site/server.js"]
