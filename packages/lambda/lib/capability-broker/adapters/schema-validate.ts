/**
 * Minimal fail-closed JSON Schema subset validator + projector (THINK-280 U5).
 *
 * The HTTP/OpenAPI adapter validates authored input against a contract's
 * `inputSchema` and the provider response against `outputSchema`. There is no
 * ajv in the broker bundle, so this hand-rolled validator covers exactly the
 * subset the reference contracts use — object/array/string/integer/number/
 * boolean/null with `properties`, `required`, `additionalProperties`, `enum`,
 * `items`, and numeric/length/size bounds. Anything unrecognized is a
 * violation, never a silent pass (repo fail-closed convention).
 *
 * `projectToSchema` drops every field not named by the schema, so the adapter
 * returns ONLY the declared safe fields and never an unbounded provider body.
 */

import type { CanonicalJson } from "@thinkwork/capability-contracts";

type Schema = Record<string, unknown>;

export function validateAgainstSchema(
  schema: CanonicalJson,
  value: unknown,
): string[] {
  const violations: string[] = [];
  walk(schema as Schema, value, "$", violations);
  return violations;
}

function walk(
  schema: Schema | unknown,
  value: unknown,
  path: string,
  violations: string[],
): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    violations.push(`${path}: schema is not an object`);
    return;
  }
  const s = schema as Schema;
  const type = s.type;

  if (value === undefined) {
    violations.push(`${path}: missing`);
    return;
  }

  switch (type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        violations.push(`${path}: expected object`);
        return;
      }
      const obj = value as Record<string, unknown>;
      const props = (s.properties as Record<string, Schema>) ?? {};
      const required = Array.isArray(s.required)
        ? (s.required as string[])
        : [];
      for (const key of required) {
        if (obj[key] === undefined) violations.push(`${path}.${key}: required`);
      }
      const additional = s.additionalProperties;
      for (const [key, v] of Object.entries(obj)) {
        if (props[key]) {
          walk(props[key], v, `${path}.${key}`, violations);
        } else if (additional === false || additional === undefined) {
          violations.push(`${path}.${key}: additional property not allowed`);
        }
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        violations.push(`${path}: expected array`);
        return;
      }
      if (typeof s.maxItems === "number" && value.length > s.maxItems) {
        violations.push(`${path}: exceeds maxItems ${s.maxItems}`);
      }
      const items = s.items as Schema | undefined;
      if (items) {
        value.forEach((item, i) =>
          walk(items, item, `${path}[${i}]`, violations),
        );
      }
      return;
    }
    case "string": {
      if (typeof value !== "string") {
        violations.push(`${path}: expected string`);
        return;
      }
      if (typeof s.maxLength === "number" && value.length > s.maxLength) {
        violations.push(`${path}: exceeds maxLength ${s.maxLength}`);
      }
      if (Array.isArray(s.enum) && !s.enum.includes(value)) {
        violations.push(`${path}: not in enum`);
      }
      return;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        violations.push(`${path}: expected ${type}`);
        return;
      }
      if (type === "integer" && !Number.isInteger(value)) {
        violations.push(`${path}: expected integer`);
      }
      if (typeof s.minimum === "number" && value < s.minimum) {
        violations.push(`${path}: below minimum ${s.minimum}`);
      }
      if (typeof s.maximum === "number" && value > s.maximum) {
        violations.push(`${path}: above maximum ${s.maximum}`);
      }
      return;
    }
    case "boolean": {
      if (typeof value !== "boolean")
        violations.push(`${path}: expected boolean`);
      return;
    }
    case "null": {
      if (value !== null) violations.push(`${path}: expected null`);
      return;
    }
    default:
      violations.push(`${path}: unsupported or missing schema type`);
  }
}

/**
 * Project a value down to exactly the fields the schema declares. Unknown
 * object keys are dropped; arrays project each element by their `items` schema.
 * Non-object/array schemas return the value unchanged (scalars are leaf-safe).
 * The result contains no provider field the contract did not name.
 */
export function projectToSchema(
  schema: CanonicalJson,
  value: unknown,
): CanonicalJson {
  return project(schema as Schema, value) as CanonicalJson;
}

function project(schema: unknown, value: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return value;
  }
  const s = schema as Schema;
  if (
    s.type === "object" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const props = (s.properties as Record<string, Schema>) ?? {};
    const out: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(props)) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = project(propSchema, v);
    }
    return out;
  }
  if (s.type === "array" && Array.isArray(value)) {
    const items = s.items as Schema | undefined;
    return items ? value.map((item) => project(items, item)) : value;
  }
  return value;
}
