import type { ComponentDef } from "./types.js";

export interface ComponentRegistry {
  register(def: ComponentDef): void;
  get(id: string): ComponentDef | undefined;
  list(): ComponentDef[];
}

export function createComponentRegistry(): ComponentRegistry {
  const defs = new Map<string, ComponentDef>();
  return {
    register(def) {
      defs.set(def.id, def);
    },
    get(id) {
      return defs.get(id);
    },
    list() {
      return [...defs.values()];
    },
  };
}
