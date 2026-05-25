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
RUN chmod +x /app/scripts/docker-entrypoint.sh
# `site` (public) and `studio` (admin) are started via docker-compose with
# different commands. Defaults to the public site.
EXPOSE 3000 4000
# The entrypoint provisions PRESSH_MASTER_KEY/CSRF on first boot (see the script)
# then exec's the command below (or the docker-compose `command:` override).
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "apps/site/dist/server.js"]
