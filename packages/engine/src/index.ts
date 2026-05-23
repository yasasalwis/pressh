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
export { safeUrl } from "./url.js";
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
export {
  createThemeRegistry,
  createThemeService,
  defaultTheme,
  renderCssVars,
  resolveTokens,
  validateTokens,
} from "./theming.js";
export type {
  ResolvedTheme,
  ThemeDefinition,
  ThemeLayoutInput,
  ThemeRegistry,
  ThemeService,
  ThemeServiceOptions,
  ThemeSettings,
  ThemeTokenDef,
  ThemeTokenType,
} from "./theming.js";
export { createSettingsService } from "./settings.js";
export type {
  GeneralSettings,
  SettingsService,
  SettingsServiceOptions,
  SmtpSettings,
  UpdateSettingsInput,
} from "./settings.js";
export { createGdprService } from "./gdpr.js";
export type {
  EncRef,
  GdprExport,
  GdprService,
  GdprServiceOptions,
  SubjectScope,
} from "./gdpr.js";
export { createContentService, PUBLISH_JOB_TYPE } from "./content-service.js";
export { createComponentRegistry } from "./components/registry.js";
export type { ComponentRegistry } from "./components/registry.js";
export type { ComponentDef, ComponentContext, ComponentPropDef, ComponentPropType, LayoutNode } from "./components/types.js";
export { DESIGNER_LAYOUT_BLOCK } from "./components/types.js";
export { registerBuiltinComponents } from "./components/builtin/index.js";
export { renderLayout, collectStyles } from "./components/render.js";
export { renderTree } from "./primitives/render.js";
export type { RenderOptions } from "./primitives/render.js";
export {
  compileTreeCss,
  compileNodeCss,
  compileDeclarations,
  cssId,
  nodeClass,
  typeClass,
} from "./primitives/css.js";
export { renderIcon, hasIcon, ICON_NAMES } from "./primitives/icons.js";
export { PRIMITIVE_DEFS, getPrimitiveDef } from "./primitives/defs.js";
export type { PrimitiveDef, PrimitiveCategory } from "./primitives/defs.js";
export {
  PRESETS,
  getPreset,
  listPresets,
  cloneWithNewIds,
  instantiatePreset,
} from "./primitives/presets.js";
export type { PresetDef } from "./primitives/presets.js";
export type {
  DesignNode,
  PrimitiveNode,
  PrimitiveType,
  StyleProps,
  ResponsiveStyles,
  StateStyles,
  Breakpoint,
  StyleState,
  Binding,
  CollectionItem,
  CollectionQuery,
  PrimitiveRenderContext,
  RenderResult,
} from "./primitives/types.js";
export type {
  ContentService,
  ContentServiceOptions,
  CreateEntryInput,
  CreateTypeInput,
  SaveEntryInput,
} from "./content-service.js";
export { SYSTEM_SLUGS } from "./types.js";
export type {
  ContentEntry,
  ContentStatus,
  ContentType,
  FieldDef,
  FieldType,
  Revision,
  SystemSlug,
} from "./types.js";
