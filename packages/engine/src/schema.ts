import { z } from "zod";
import { PressError } from "@pressh/core";
import type { FieldDef } from "./types.js";

/** Maps a content-type field definition to a Zod schema. */
function fieldToZod(field: FieldDef): z.ZodType {
  let schema: z.ZodType;
  switch (field.type) {
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "select": {
      const options = field.options ?? [];
      schema = options.length > 0 ? z.enum(options as [string, ...string[]]) : z.string();
      break;
    }
    case "text":
    case "richtext":
    case "date":
    default:
      schema = z.string();
      break;
  }
  return field.required ? schema : schema.optional();
}

/** Builds a Zod object schema from a content type's fields. */
export function buildSchema(fields: readonly FieldDef[]): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) shape[field.name] = fieldToZod(field);
  return z.object(shape);
}

/** Validates field data, throwing PressError("validation") with issue details. */
export function validateFields(
  fields: readonly FieldDef[],
  data: unknown,
): Record<string, unknown> {
  const result = buildSchema(fields).safeParse(data);
  if (!result.success) {
    throw new PressError("validation", "Field validation failed", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data as Record<string, unknown>;
}
