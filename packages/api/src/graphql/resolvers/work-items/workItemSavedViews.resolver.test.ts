import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCanReadTenantSpaces,
  mockHasSpaceMemberAccess,
  mockListWorkItemSavedViews,
  mockResolveCallerUserId,
} = vi.hoisted(() => ({
  mockCanReadTenantSpaces: vi.fn(async () => true),
  mockHasSpaceMemberAccess: vi.fn(async () => true),
  mockListWorkItemSavedViews: vi.fn(),
  mockResolveCallerUserId: vi.fn(async () => "user-1"),
}));

vi.mock("../../../lib/work-items/saved-view-service.js", () => ({
  listWorkItemSavedViews: mockListWorkItemSavedViews,
}));

vi.mock("../spaces/shared.js", () => ({
  canReadTenantSpaces: mockCanReadTenantSpaces,
  hasSpaceMemberAccess: mockHasSpaceMemberAccess,
  userAccessibleSpacePredicate: vi.fn(),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../utils.js", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  asc: vi.fn((column: unknown) => ({ asc: column })),
  db: {
    select: vi.fn(),
  },
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  spaces: {},
  snakeToCamel: (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        value instanceof Date ? value.toISOString() : value,
      ]),
    ),
  workItemEvents: {},
  workItemExternalRefs: {},
  workItemSavedViews: {},
  workItemStatuses: {},
  workItemThreadLinks: {},
  workItems: {},
}));

import { workItemSavedViews } from "./workItemSavedViews.query.js";

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  mockCanReadTenantSpaces.mockReset();
  mockCanReadTenantSpaces.mockResolvedValue(true);
  mockHasSpaceMemberAccess.mockReset();
  mockHasSpaceMemberAccess.mockResolvedValue(true);
  mockResolveCallerUserId.mockReset();
  mockResolveCallerUserId.mockResolvedValue("user-1");
  mockListWorkItemSavedViews.mockReset();
  mockListWorkItemSavedViews.mockResolvedValue([
    {
      id: "view-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      space_id: "space-1",
      name: "Onboarding blockers",
      view_type: "board",
      filters: { blocked: true },
      grouping: {},
      sorting: {},
      view_config: {},
      is_private: true,
      is_default: false,
      is_favorite: true,
    },
  ]);
});

describe("workItemSavedViews", () => {
  it("uses the caller identity when listing personal saved views", async () => {
    const result = await workItemSavedViews(
      {},
      { tenantId: "tenant-1", spaceId: "space-1" },
      ctx,
    );

    expect(mockHasSpaceMemberAccess).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "space-1",
    );
    expect(mockListWorkItemSavedViews).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      spaceId: "space-1",
    });
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: "view-1",
        viewType: "BOARD",
        isFavorite: true,
      }),
    );
  });

  it("returns empty when the caller cannot access the requested Space", async () => {
    mockHasSpaceMemberAccess.mockResolvedValue(false);

    await expect(
      workItemSavedViews({}, { tenantId: "tenant-1", spaceId: "space-1" }, ctx),
    ).resolves.toEqual([]);
    expect(mockListWorkItemSavedViews).not.toHaveBeenCalled();
  });
});
