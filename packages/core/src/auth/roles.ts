/**
 * Role → capability model (FR-003). Roles resolve to capability strings that
 * the Phase-1 CapabilityGate matches. Wildcards keep the lists small:
 * `content.*` matches `content.read`, `content.publish`, etc.
 */
export type RoleName = "owner" | "admin" | "editor" | "author" | "viewer";

export const ROLE_NAMES: readonly RoleName[] = ["owner", "admin", "editor", "author", "viewer"];

export const ROLE_CAPABILITIES: Record<RoleName, readonly string[]> = {
  // The owner is the single super-user; `*` matches every capability.
  owner: ["*"],
  admin: [
    "users.manage",
    "plugins.manage",
    "themes.manage",
    "settings.manage",
    "types.manage",
    "content.*",
    "media.*",
    "menus.manage",
    "forms.manage",
    "gdpr.manage",
    "audit.read",
    "db.manage",
  ],
  editor: [
    "content.create",
    "content.read",
    "content.update",
    "content.submit",
    "content.publish",
    "media.write",
    "media.read",
    "menus.manage",
    "forms.manage",
  ],
  author: [
    "content.create",
    "content.read",
    "content.update",
    "content.submit",
    "media.write",
    "media.read",
  ],
  viewer: ["content.read", "media.read"],
};

export function isRoleName(value: string): value is RoleName {
  return (ROLE_NAMES as readonly string[]).includes(value);
}

/** Union of all capabilities granted by the given roles. */
export function capabilitiesForRoles(roles: readonly RoleName[]): string[] {
  const granted = new Set<string>();
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role]) granted.add(capability);
  }
  return [...granted];
}
