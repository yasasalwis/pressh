import { describe, it, expect } from "vitest";
import { PRESSH_CORE_VERSION } from "@pressh/core";

describe("@pressh/core", () => {
  it("exposes a version string", () => {
    expect(PRESSH_CORE_VERSION).toBe("0.0.0");
  });
});
