import { describe, expect, it } from "vitest";

import {
  MemoryScopeError,
  assertSharedScope,
  assertTargetInTenant,
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

describe("assertTargetInTenant", () => {
  const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
  const fakeDb = (spaceRows: unknown[]) =>
    ({
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => spaceRows }),
        }),
      }),
    }) as never;

  it("accepts a tenant target that is the processor's own tenant", async () => {
    await expect(
      assertTargetInTenant(fakeDb([]), {
        id: "p1",
        tenant_id: TENANT_ID,
        target_scope: "tenant",
        target_id: TENANT_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a tenant target pointing at ANOTHER tenant's bank (R11)", async () => {
    await expect(
      assertTargetInTenant(fakeDb([]), {
        id: "p1",
        tenant_id: TENANT_ID,
        target_scope: "tenant",
        target_id: OTHER_TENANT,
      }),
    ).rejects.toThrow(MemoryScopeError);
  });

  it("accepts a space target owned by the tenant", async () => {
    await expect(
      assertTargetInTenant(fakeDb([{ id: SPACE_ID }]), {
        id: "p1",
        tenant_id: TENANT_ID,
        target_scope: "space",
        target_id: SPACE_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a space target the tenant does not own", async () => {
    await expect(
      assertTargetInTenant(fakeDb([]), {
        id: "p1",
        tenant_id: TENANT_ID,
        target_scope: "space",
        target_id: SPACE_ID,
      }),
    ).rejects.toThrow(MemoryScopeError);
  });
});
