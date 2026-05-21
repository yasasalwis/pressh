import { describe, it, expect } from "vitest";
import { CapabilityGate, capabilitiesForRoles, isRoleName } from "@pressh/core";

const gate = new CapabilityGate();

describe("role → capability resolution", () => {
  it("owner gets the god capability", () => {
    expect(gate.check(capabilitiesForRoles(["owner"]), "anything.at.all")).toBe(true);
  });

  it("editor can publish, author cannot", () => {
    expect(gate.check(capabilitiesForRoles(["editor"]), "content.publish")).toBe(true);
    expect(gate.check(capabilitiesForRoles(["author"]), "content.publish")).toBe(false);
  });

  it("viewer can read but not mutate", () => {
    expect(gate.check(capabilitiesForRoles(["viewer"]), "content.read")).toBe(true);
    expect(gate.check(capabilitiesForRoles(["viewer"]), "content.update")).toBe(false);
  });

  it("admin's content.* wildcard covers content.read", () => {
    expect(gate.check(capabilitiesForRoles(["admin"]), "content.read")).toBe(true);
    expect(gate.check(capabilitiesForRoles(["admin"]), "users.manage")).toBe(true);
  });

  it("unions capabilities across multiple roles", () => {
    const caps = capabilitiesForRoles(["viewer", "author"]);
    expect(gate.check(caps, "content.create")).toBe(true);
  });

  it("validates role names", () => {
    expect(isRoleName("editor")).toBe(true);
    expect(isRoleName("superuser")).toBe(false);
  });
});
