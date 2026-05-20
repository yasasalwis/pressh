import { describe, it, expect } from "vitest";
import { CapabilityGate, capabilityMatches, parseCapability, PressError } from "@pressh/core";

describe("parseCapability", () => {
  it("parses path and scope", () => {
    expect(parseCapability("storage.read:posts")).toEqual({
      path: ["storage", "read"],
      scope: "posts",
    });
  });
  it("parses an unscoped capability", () => {
    expect(parseCapability("media.write")).toEqual({ path: ["media", "write"], scope: null });
  });
});

describe("capabilityMatches", () => {
  it("matches exact", () => {
    expect(capabilityMatches("storage.read:posts", "storage.read:posts")).toBe(true);
  });
  it("denies a different scope", () => {
    expect(capabilityMatches("storage.read:posts", "storage.read:pages")).toBe(false);
  });
  it("scope wildcard matches any scope", () => {
    expect(capabilityMatches("storage.read:*", "storage.read:posts")).toBe(true);
  });
  it("an unscoped grant does NOT grant a scoped capability", () => {
    expect(capabilityMatches("storage.read", "storage.read:posts")).toBe(false);
  });
  it("single-segment wildcard matches one action segment", () => {
    expect(capabilityMatches("storage.*", "storage.read")).toBe(true);
    expect(capabilityMatches("storage.*", "media.read")).toBe(false);
  });
  it("a wildcard action without scope wildcard does not grant scoped access", () => {
    expect(capabilityMatches("storage.*", "storage.read:posts")).toBe(false);
  });
  it("** matches deeper paths", () => {
    expect(capabilityMatches("storage.**", "storage.read")).toBe(true);
  });
  it("* is the god capability", () => {
    expect(capabilityMatches("*", "anything.at.all:scope")).toBe(true);
  });
});

describe("CapabilityGate", () => {
  const gate = new CapabilityGate();

  it("default-denies an empty grant list", () => {
    expect(gate.check([], "storage.read:posts")).toBe(false);
  });
  it("allows when any granted capability matches", () => {
    expect(gate.check(["media.write", "storage.read:posts"], "storage.read:posts")).toBe(true);
  });
  it("assert throws PressError(capability_denied) when denied", () => {
    try {
      gate.assert([], "storage.raw");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PressError);
      expect((e as PressError).code).toBe("capability_denied");
    }
  });
  it("assert does not throw when granted", () => {
    expect(() => gate.assert(["storage.raw"], "storage.raw")).not.toThrow();
  });
});
