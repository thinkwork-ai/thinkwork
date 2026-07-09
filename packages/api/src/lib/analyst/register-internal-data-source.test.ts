/**
 * validateInternalRegisterInput tests (THINK-239).
 */

import { describe, expect, it } from "vitest";

import { AnalystRegistrationInputError } from "./register-data-source.js";
import { validateInternalRegisterInput } from "./register-internal-data-source.js";

const base = {
  clusterId: "thinkwork-dev-aurora",
  database: "sales",
  name: "Sales Postgres",
  slug: "sales-pg",
};

describe("validateInternalRegisterInput", () => {
  it("normalizes a valid input", () => {
    expect(validateInternalRegisterInput({ ...base })).toEqual(base);
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
