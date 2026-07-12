import { describe, expect, it } from "vitest";

import {
  MemoryScopeError,
  assertSharedScope,
  resolveTargetBankId,
} from "./repository.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SPACE_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";

describe("assertSharedScope", () => {
  it("accepts shared processors targeting tenant scope", () => {
    expect(() =>
      assertSharedScope({
        id: "p1",
        mode: "shared",
        target_scope: "tenant",
      }),
    ).not.toThrow();
  });

  it("accepts shared processors targeting space scope", () => {
    expect(() =>
      assertSharedScope({ id: "p1", mode: "shared", target_scope: "space" }),
    ).not.toThrow();
  });

  it("rejects personal-mode processors with MemoryScopeError (R11/AE7)", () => {
    expect(() =>
      assertSharedScope({ id: "p1", mode: "personal", target_scope: "tenant" }),
    ).toThrow(MemoryScopeError);
  });

  it("rejects user-scope targets even in shared mode (R11/AE7)", () => {
    const attempt = () =>
      assertSharedScope({ id: "p1", mode: "shared", target_scope: "user" });
    expect(attempt).toThrow(MemoryScopeError);
    try {
      attempt();
    } catch (err) {
      expect((err as MemoryScopeError).name).toBe("MemoryScopeError");
    }
  });
});

describe("resolveTargetBankId", () => {
  it("builds tenant bank ids", () => {
    expect(
      resolveTargetBankId({ target_scope: "tenant", target_id: TENANT_ID }),
    ).toBe(`tenant_${TENANT_ID}`);
  });

  it("builds space bank ids", () => {
    expect(
      resolveTargetBankId({ target_scope: "space", target_id: SPACE_ID }),
    ).toBe(`space_${SPACE_ID}`);
  });
});
