import { describe, it, expect } from "vitest";
import { capabilityForTransition, isAllowedTransition } from "@pressh/engine";

describe("content state machine", () => {
  it("allows draft → in_review → published", () => {
    expect(isAllowedTransition("draft", "in_review")).toBe(true);
    expect(isAllowedTransition("in_review", "published")).toBe(true);
  });

  it("forbids illegal transitions", () => {
    expect(isAllowedTransition("archived", "published")).toBe(false);
    expect(isAllowedTransition("published", "in_review")).toBe(false);
  });

  it("maps transitions to the right capability", () => {
    expect(capabilityForTransition("in_review")).toBe("content.submit");
    expect(capabilityForTransition("published")).toBe("content.publish");
    expect(capabilityForTransition("scheduled")).toBe("content.publish");
    expect(capabilityForTransition("draft")).toBe("content.update");
  });
});
