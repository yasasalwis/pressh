// @pressh/core — kernel
//
// No HTTP, no React, no content knowledge. The smallest layer Pressh can run on.
// See docs/ARCHITECTURE.md §4.

export const CORE_VERSION = "0.1.0";

export type PluginId = string & { readonly __brand: "PluginId" };
export type Capability = string & { readonly __brand: "Capability" };
