import { describe, expect, it } from "vitest";
import {
  activeAssignedComputers,
  resolveMobileTenantId,
} from "../mobile-tenant";

describe("mobile tenant resolution", () => {
  it("prefers the authenticated tenant id when present", () => {
    expect(
      resolveMobileTenantId("tenant-auth", "tenant-me", [
        { tenantId: "tenant-computer" },
      ]),
    ).toBe("tenant-auth");
  });

  it("falls back to me.tenantId for federated sessions without a tenant claim", () => {
    expect(resolveMobileTenantId(null, "tenant-me", [])).toBe("tenant-me");
  });

  it("falls back to assigned Computers before declaring the user unassigned", () => {
    expect(
      resolveMobileTenantId(undefined, undefined, [
        { tenantId: "tenant-archived", status: "archived" },
        { tenantId: "tenant-computer", status: "active" },
      ]),
    ).toBe("tenant-computer");
  });

  it("filters archived Computers out of selectable assignments", () => {
    expect(
      activeAssignedComputers([
        { tenantId: "tenant-1", status: "archived" },
        { tenantId: "tenant-1", status: "active" },
        { tenantId: "tenant-1" },
      ]),
    ).toHaveLength(2);
  });
});
