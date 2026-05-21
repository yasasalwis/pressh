import type { ContentStatus } from "./types.js";

/**
 * Content lifecycle (TDD §state machine). Transitions are capability-gated by
 * `capabilityForTransition`. Anything not listed here is an illegal transition.
 */
export const TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ["in_review", "scheduled", "published"],
  in_review: ["draft", "scheduled", "published"],
  scheduled: ["published", "draft"],
  published: ["draft", "archived"],
  archived: ["draft"],
};

export function isAllowedTransition(from: ContentStatus, to: ContentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The capability required to move a piece of content into `to`. */
export function capabilityForTransition(to: ContentStatus): string {
  switch (to) {
    case "in_review":
      return "content.submit";
    case "scheduled":
    case "published":
    case "archived":
      return "content.publish";
    case "draft":
      return "content.update";
  }
}
