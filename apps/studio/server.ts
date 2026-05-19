import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

// Placeholder studio server.
//
// In production this process:
//   1. Boots a PluginHost (from @pressh/core) at startup.
//   2. Serves the built Vite SPA from ./dist/spa.
//   3. Mounts admin API routes (/api/*), plugin RPC dispatch
//      (/api/p/:plugin/*), and plugin iframe panels
//      (/__plugin-ui/:plugin/*).
//
// In dev, run `npm run dev` to use Vite's dev server with HMR.
// This server is only used in production / for end-to-end testing.

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

app.use("/*", serveStatic({ root: "./dist/spa" }));

const port = Number(process.env.PRESSH_STUDIO_PORT ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[pressh:studio] listening on http://localhost:${info.port}`);
});
