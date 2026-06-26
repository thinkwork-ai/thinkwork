import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireMemoryTenantScope } from "../core/require-user-scope.js";
import { hasSpaceMemberAccess } from "../spaces/shared.js";
import { requireSpaceMemoryScope } from "./space-memory-scope.js";

vi.mock("../core/require-user-scope.js", async () => {
  const actual = await vi.importActual<
    typeof import("../core/require-user-scope.js")
  >("../core/require-user-scope.js");
  return {
    ...actual,
    requireMemoryTenantScope: vi.fn(),
  };
});

vi.mock("../spaces/shared.js", () => ({
  hasSpaceMemberAccess: vi.fn(),
}));

const requireMemoryTenantScopeMock = vi.mocked(requireMemoryTenantScope);
const hasSpaceMemberAccessMock = vi.mocked(hasSpaceMemberAccess);

describe("requireSpaceMemoryScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireMemoryTenantScopeMock.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-1",
    });
    hasSpaceMemberAccessMock.mockResolvedValue(true);
  });

  it("returns the tenant, space, and requester when the caller can access the space", async () => {
    const result = await requireSpaceMemoryScope({} as any, {
      tenantId: "tenant-1",
      spaceId: "space-1",
    });

    expect(requireMemoryTenantScopeMock).toHaveBeenCalledWith(
      {},
      { tenantId: "tenant-1", spaceId: "space-1" },
    );
    expect(hasSpaceMemberAccessMock).toHaveBeenCalledWith(
      {},
      "tenant-1",
      "space-1",
    );
    expect(result).toEqual({
      tenantId: "tenant-1",
      spaceId: "space-1",
      requesterUserId: "user-1",
    });
  });

  it("rejects callers that cannot access the requested space", async () => {
    hasSpaceMemberAccessMock.mockResolvedValue(false);

    await expect(
      requireSpaceMemoryScope({} as any, {
        tenantId: "tenant-1",
        spaceId: "space-1",
      }),
    ).rejects.toThrow("Access denied: space mismatch");
  });
});
