/**
 * @pressh/engine — content runtime.
 *
 * Phase 5: content types/fields (Zod-validated), entries, immutable revisions,
 * the capability-gated draft→review→publish state machine, and i18n per-locale
 * variants. Blocks + sanitization (Phase 6), query resolver (Phase 7), media,
 * render, and GDPR services follow.
 */
export const PRESSH_ENGINE_VERSION = "0.0.0";

export { buildSchema, validateFields } from "./schema.js";
export { builtinBlocks, createBlockRegistry } from "./blocks/registry.js";
export { sanitizeBlocks, FALLBACK_BLOCK_TYPE } from "./blocks/sanitize.js";
export type { BlockDefinition, BlockNode, BlockRegistry } from "./blocks/types.js";
export {
  TRANSITIONS,
  capabilityForTransition,
  isAllowedTransition,
} from "./state-machine.js";
export { createQueryResolver, parsePath } from "./resolver.js";
export type {
  ParsePathOptions,
  ParsedRoute,
  QueryResolver,
  QueryResolverOptions,
  ResolveOptions,
  ResolveScope,
  ResolvedContent,
} from "./resolver.js";
export { createContentService } from "./content-service.js";
export type {
  ContentService,
  ContentServiceOptions,
  CreateEntryInput,
  CreateTypeInput,
  SaveEntryInput,
} from "./content-service.js";
export type {
  ContentEntry,
  ContentStatus,
  ContentType,
  FieldDef,
  FieldType,
  Revision,
} from "./types.js";
