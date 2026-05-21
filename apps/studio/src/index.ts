/**
 * @pressh/studio — admin process (Hono admin API + served admin client).
 *
 * Phase 10: session/CSRF/capability middleware, no-code content-type modeling,
 * block-based authoring, validated media upload, and the seed CLI. The
 * Vite/React/ui-kit visual drag-drop builder is the next increment.
 */
export { createStudioApp } from "./app.js";
export type { StudioAppDeps } from "./app.js";
export { createMediaService, validateUpload } from "./media.js";
export type { MediaRecord, MediaService, MediaServiceOptions } from "./media.js";
export { seedOwner } from "./seed.js";
export { createStudioServer } from "./server.js";
export type { StudioServerOptions } from "./server.js";
