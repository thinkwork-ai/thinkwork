/**
 * validateInternalRegisterInput tests (THINK-239; schema input by THINK-283).
 */

import { describe, expect, it } from "vitest";

import { AnalystRegistrationInputError } from "./register-data-source.js";
import {
  normalizeAnalystSourceSchema,
  validateInternalRegisterInput,
} from "./register-internal-data-source.js";

const base = {
  clusterId: "thinkwork-dev-aurora",
  database: "sales",
  name: "Sales Postgres",
  slug: "sales-pg",
};

describe("validateInternalRegisterInput", () => {
  it("normalizes a valid input (omitted schema defaults to public)", () => {
    expect(validateInternalRegisterInput({ ...base })).toEqual({
      ...base,
      schema: "public",
    });
  });

  it("preserves an explicit schema's exact catalog case (THINK-283)", () => {
    expect(
      validateInternalRegisterInput({ ...base, schema: " RawJde " }).schema,
    ).toBe("RawJde");
  });

  it("rejects an empty name", () => {
    expect(() =>
      validateInternalRegisterInput({ ...base, name: "  " }),
    ).toThrow(AnalystRegistrationInputError);
  });

  it("rejects a bad slug and the reserved postgres-dev slug", () => {
    expect(() =>
      validateInternalRegisterInput({ ...base, slug: "-Bad" }),
    ).toThrow(/invalid/);
    expect(() =>
      validateInternalRegisterInput({ ...base, slug: "postgres-dev" }),
    ).toThrow(/reserved/);
  });

  it("rejects a missing clusterId or database", () => {
    expect(() =>
      validateInternalRegisterInput({ ...base, clusterId: "" }),
    ).toThrow(/clusterId is required/);
    expect(() =>
      validateInternalRegisterInput({ ...base, database: "" }),
    ).toThrow(/database is required/);
  });

  it("hard-rejects the thinkwork workspace database", () => {
    expect(() =>
      validateInternalRegisterInput({ ...base, database: "thinkwork" }),
    ).toThrow(/built-in connector/);
  });
});

describe("normalizeAnalystSourceSchema (THINK-283)", () => {
  it("omitted/null → public; explicit values are trimmed with case preserved", () => {
    expect(normalizeAnalystSourceSchema(undefined)).toBe("public");
    expect(normalizeAnalystSourceSchema(null)).toBe("public");
    expect(normalizeAnalystSourceSchema("raw_jde")).toBe("raw_jde");
    expect(normalizeAnalystSourceSchema(" RawJde ")).toBe("RawJde");
  });

  it("an explicitly supplied empty/whitespace schema is an error, never a fallback", () => {
    expect(() => normalizeAnalystSourceSchema("")).toThrow(
      AnalystRegistrationInputError,
    );
    expect(() => normalizeAnalystSourceSchema("   ")).toThrow(/non-empty/);
  });

  it("rejects NUL bytes and PostgreSQL system schemas", () => {
    expect(() => normalizeAnalystSourceSchema("bad\0name")).toThrow(
      /invalid characters/,
    );
    expect(() => normalizeAnalystSourceSchema("pg_catalog")).toThrow(
      /system schema/,
    );
    expect(() => normalizeAnalystSourceSchema("information_schema")).toThrow(
      /system schema/,
    );
  });

  it("never lowercases a case-mismatched schema (exact catalog identity)", () => {
    expect(normalizeAnalystSourceSchema("RAW_JDE")).toBe("RAW_JDE");
  });
});
