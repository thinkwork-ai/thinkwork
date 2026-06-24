import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCanReadTenantSpaces, mockHasSpaceMemberAccess, mockListWorkItems } =
  vi.hoisted(() => ({
    mockCanReadTenantSpaces: vi.fn(async () => true),
    mockHasSpaceMemberAccess: vi.fn(async () => true),
    mockListWorkItems: vi.fn(),
  }));

vi.mock("../../../lib/work-items/work-item-service.js", () => ({
  listWorkItems: mockListWorkItems,
}));

vi.mock("../spaces/shared.js", () => ({
  canReadTenantSpaces: mockCanReadTenantSpaces,
  hasSpaceMemberAccess: mockHasSpaceMemberAccess,
  userAccessibleSpacePredicate: vi.fn(),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: vi.fn(async () => "user-1"),
}));

vi.mock("../../utils.js", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  asc: vi.fn((column: unknown) => ({ asc: column })),
  db: {
    select: vi.fn(),
  },
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  spaces: {
    id: { __column__: "spaces.id" },
    tenant_id: { __column__: "spaces.tenant_id" },
    status: { __column__: "spaces.status" },
  },
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

import { workItems } from "./workItems.query.js";

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  mockCanReadTenantSpaces.mockReset();
  mockCanReadTenantSpaces.mockResolvedValue(true);
  mockHasSpaceMemberAccess.mockReset();
  mockHasSpaceMemberAccess.mockResolvedValue(true);
  mockListWorkItems.mockReset();
  mockListWorkItems.mockResolvedValue({
    items: [
      {
        id: "work-item-1",
        tenant_id: "tenant-1",
        space_id: "space-1",
        status_id: "status-1",
        title: "Collect kickoff notes",
        priority: "high",
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
});

describe("workItems", () => {
  it("intersects requested Space filters with spaces the caller can access", async () => {
    (mockHasSpaceMemberAccess as any).mockImplementation(
      async (_ctx: unknown, _tenant: string, spaceId: string) =>
        spaceId === "space-1",
    );

    const result = await workItems(
      {},
      {
        input: {
          tenantId: "tenant-1",
          spaceIds: ["space-1", "space-2"],
          statusCategories: ["TODO"],
        },
      },
      ctx,
    );

    expect(mockListWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        spaceIds: ["space-1"],
        statusCategories: ["TODO"],
      }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: "work-item-1",
        tenantId: "tenant-1",
        priority: "HIGH",
      }),
    );
  });

  it("returns an empty connection without querying work items when no requested Spaces are visible", async () => {
    mockHasSpaceMemberAccess.mockResolvedValue(false);

    const result = await workItems(
      {},
      { input: { tenantId: "tenant-1", spaceIds: ["space-private"] } },
      ctx,
    );

    expect(mockListWorkItems).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });
});
