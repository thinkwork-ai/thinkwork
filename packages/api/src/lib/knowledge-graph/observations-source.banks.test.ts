/**
 * validateExplicitBankIds — targeted shared-bank loading guardrail
 * (THINK-193 U4). Personal `user_*` banks must be rejected outright; only
 * `space_*` / `tenant_*` shared banks may be explicitly targeted.
 */

import { describe, expect, it } from "vitest";
import { validateExplicitBankIds } from "./observations-source.js";

describe("validateExplicitBankIds", () => {
  it("accepts space_ and tenant_ banks with null userId", () => {
    expect(validateExplicitBankIds(["tenant_abc123", "space_9f8e-7d"])).toEqual(
      [
        { bankId: "tenant_abc123", userId: null },
        { bankId: "space_9f8e-7d", userId: null },
      ],
    );
  });

  it("rejects user_ banks (personal banks never flow through targeted ingest)", () => {
    expect(() =>
      validateExplicitBankIds(["user_11111111-2222-3333-4444-555555555555"]),
    ).toThrow(/not allowed/);
  });

  it("rejects unknown prefixes and malformed ids", () => {
    expect(() => validateExplicitBankIds(["global"])).toThrow(/not allowed/);
    expect(() => validateExplicitBankIds(["tenant_"])).toThrow(/not allowed/);
    expect(() => validateExplicitBankIds(["tenant_abc; DROP"])).toThrow(
      /not allowed/,
    );
  });

  it("dedupes repeated banks", () => {
    expect(validateExplicitBankIds(["tenant_a", "tenant_a"])).toHaveLength(1);
  });
});
