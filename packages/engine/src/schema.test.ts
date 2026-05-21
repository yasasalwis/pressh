import { describe, it, expect } from "vitest";
import { validateFields } from "@pressh/engine";
import type { FieldDef } from "@pressh/engine";

const fields: FieldDef[] = [
  { id: "1", name: "title", type: "text", required: true },
  { id: "2", name: "views", type: "number", required: false },
  { id: "3", name: "featured", type: "boolean", required: false },
  { id: "4", name: "tier", type: "select", required: true, options: ["free", "pro"] },
];

describe("validateFields", () => {
  it("accepts valid data", () => {
    const data = validateFields(fields, { title: "Hello", views: 5, tier: "pro" });
    expect(data["title"]).toBe("Hello");
  });

  it("rejects a missing required field", () => {
    expect(() => validateFields(fields, { tier: "pro" })).toThrowError(/validation/i);
  });

  it("rejects a wrong type", () => {
    expect(() => validateFields(fields, { title: 123, tier: "pro" })).toThrow();
  });

  it("rejects an out-of-set select value", () => {
    expect(() => validateFields(fields, { title: "x", tier: "enterprise" })).toThrow();
  });

  it("allows omitting optional fields", () => {
    expect(() => validateFields(fields, { title: "x", tier: "free" })).not.toThrow();
  });
});
