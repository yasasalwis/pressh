# Pressh — single image, two entrypoints (site / studio). ADR-002 trust split.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY adapters ./adapters
COPY apps ./apps
COPY scripts ./scripts
COPY builtins ./builtins
RUN npm ci && npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
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
RUN chmod +x /app/scripts/docker-entrypoint.sh \
 && mkdir -p /data \
 && chown -R node:node /data /app/builtins
USER node
# `site` (public) and `studio` (admin) are started via docker-compose with
# different commands. Defaults to the public site.
EXPOSE 3000 4000
# The entrypoint provisions PRESSH_MASTER_KEY/CSRF on first boot (see the script)
# then exec's the command below (or the docker-compose `command:` override).
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "apps/site/dist/server.js"]
