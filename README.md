# Pressh

A secure-by-default, no-code CMS — the WordPress alternative that doesn't leak data.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

## Workspace layout

```
apps/studio/     admin app  — Vite + Hono + React 19 SPA
apps/site/       public app — Next.js 16 SSR
packages/        core, engine, sdk, runtime, ui-kit
adapters/        optional storage connectors (postgres, sqlite, mongo)
plugins/         user-dropped plugins (loaded at runtime, worker-isolated)
themes/          user-dropped themes
content/         default filesystem content store
```

## Dev

```bash
npm install
npm run dev:studio   # http://localhost:5173
npm run dev:site     # http://localhost:3000
npm run typecheck    # tsc -b across the workspace
```

Requires Node 20+ and npm 10+.
