/**
 * @pressh/studio — admin process (Hono admin API + served React admin client).
 *
 * Session/CSRF/capability middleware, no-code content-type modeling, the visual
 * primitive designer, validated media upload, and the seed CLI.
 */
export { createStudioApp } from "./app.js";
export type { StudioAppDeps } from "./app.js";
export { createMediaService, validateUpload } from "./media.js";
export type { MediaRecord, MediaService, MediaServiceOptions } from "./media.js";
export { seedOwner } from "./seed.js";
export { createStudioServer } from "./server.js";
export type { StudioServerOptions } from "./server.js";
