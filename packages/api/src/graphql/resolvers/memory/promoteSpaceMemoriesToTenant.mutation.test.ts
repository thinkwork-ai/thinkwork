import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMemoryTenantScopeMock = vi.hoisted(() => vi.fn());
const isTenantAdminMock = vi.hoisted(() => vi.fn());
const hasSpaceMemberAccessMock = vi.hoisted(() => vi.fn());
const promoteMock = vi.hoisted(() => vi.fn());

vi.mock("../core/require-user-scope.js", () => ({
  requireMemoryTenantScope: requireMemoryTenantScopeMock,
  isTenantAdmin: isTenantAdminMock,
  UserScopeAuthError: class UserScopeAuthError extends Error {},
}));
vi.mock("../spaces/shared.js", () => ({
  hasSpaceMemberAccess: hasSpaceMemberAccessMock,
}));
vi.mock("../../../lib/memory/promotion.js", () => ({
  promoteSpaceMemoriesToTenant: promoteMock,
}));

import { promoteSpaceMemoriesToTenant } from "./promoteSpaceMemoriesToTenant.mutation.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SPACE_ID = "958bb3f6-1508-4ac9-8ba3-6d5bea586a00";
const USER_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const CTX = {} as never;

describe("promoteSpaceMemoriesToTenant mutation (KTD-8 dual-ended authz)", () => {
  beforeEach(() => {
    requireMemoryTenantScopeMock
      .mockReset()
      .mockResolvedValue({ tenantId: TENANT_ID, userId: USER_ID });
    isTenantAdminMock.mockReset().mockResolvedValue(true);
    hasSpaceMemberAccessMock.mockReset().mockResolvedValue(true);
    promoteMock
      .mockReset()
      .mockResolvedValue({ promoted: [], alreadyPromoted: [], missing: [] });
  });

  it("promotes when the caller is tenant admin with source-space access", async () => {
    await promoteSpaceMemoriesToTenant(
      undefined,
      {
        spaceId: SPACE_ID,
        memoryIds: ["aaaaaaaa-0000-0000-0000-000000000001"],
        justification: "why",
      },
      CTX,
    );
    expect(promoteMock).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      spaceId: SPACE_ID,
      memoryIds: ["aaaaaaaa-0000-0000-0000-000000000001"],
      justification: "why",
      actorId: USER_ID,
    });
  });

  it("denies a tenant member who is not owner/admin", async () => {
    isTenantAdminMock.mockResolvedValue(false);
    await expect(
      promoteSpaceMemoriesToTenant(
        undefined,
        { spaceId: SPACE_ID, memoryIds: [], justification: "why" },
        CTX,
      ),
    ).rejects.toThrow(/owner\/admin/);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it("denies a tenant admin without read access to the source space (KTD-8 source gate)", async () => {
    hasSpaceMemberAccessMock.mockResolvedValue(false);
    await expect(
      promoteSpaceMemoriesToTenant(
        undefined,
        { spaceId: SPACE_ID, memoryIds: [], justification: "why" },
        CTX,
      ),
    ).rejects.toThrow(/source space/);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it("denies user-less service callers", async () => {
    requireMemoryTenantScopeMock.mockResolvedValue({
      tenantId: TENANT_ID,
      userId: null,
    });
    await expect(
      promoteSpaceMemoriesToTenant(
        undefined,
        { spaceId: SPACE_ID, memoryIds: [], justification: "why" },
        CTX,
      ),
    ).rejects.toThrow(/user actor/);
    expect(promoteMock).not.toHaveBeenCalled();
  });
});
