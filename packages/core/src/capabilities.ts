import { PressError } from "./errors.js";

/**
 * Capability strings are `<dot.path>` or `<dot.path>:<scope>`, e.g.
 *   storage.read:posts   network.fetch:api.stripe.com   media.write   storage.raw
 *
 * Matching semantics (granted vs required) — deliberately strict, since this is
 * the default-deny security gate:
 *   - `*` (alone) is the god capability and matches everything.
 *   - `**` as a path segment matches that segment and all deeper segments.
 *   - `*` as a path segment matches exactly one segment.
 *   - A scope of `*` matches any required scope (and the absence of one).
 *   - Otherwise scopes must be equal — so an UNSCOPED grant (`storage.read`)
 *     does NOT grant a SCOPED capability (`storage.read:posts`). To grant all
 *     scopes you must say so explicitly with `:*`.
 */
export interface ParsedCapability {
  readonly path: readonly string[];
  readonly scope: string | null;
}

export function parseCapability(cap: string): ParsedCapability {
  const colon = cap.indexOf(":");
  const pathPart = colon === -1 ? cap : cap.slice(0, colon);
  const scope = colon === -1 ? null : cap.slice(colon + 1);
  const path = pathPart.split(".").filter((segment) => segment.length > 0);
  return { path, scope };
}

function pathMatches(granted: readonly string[], required: readonly string[]): boolean {
  for (let i = 0; i < granted.length; i++) {
    const g = granted[i];
    if (g === undefined) return false; // unreachable within bounds; keeps types honest
    if (g === "**") return true;
    const r = required[i];
    if (r === undefined) return false; // granted path is more specific than required
    if (g === "*") continue;
    if (g !== r) return false;
  }
  return granted.length === required.length;
}

function scopeMatches(granted: string | null, required: string | null): boolean {
  if (granted === "*") return true;
  return granted === required;
}

export function capabilityMatches(granted: string, required: string): boolean {
  if (granted === "*") return true;
  const g = parseCapability(granted);
  const r = parseCapability(required);
  if (!pathMatches(g.path, r.path)) return false;
  return scopeMatches(g.scope, r.scope);
}

/**
 * Authoritative, default-deny gate. An empty grant list denies everything.
 * Used host-side before every cross-boundary plugin RPC (Phase 8).
 */
export class CapabilityGate {
  check(granted: readonly string[], required: string): boolean {
    return granted.some((g) => capabilityMatches(g, required));
  }

  assert(granted: readonly string[], required: string): void {
    if (!this.check(granted, required)) {
      throw new PressError("capability_denied", `Capability denied: ${required}`, {
        required,
      });
    }
  }
}
