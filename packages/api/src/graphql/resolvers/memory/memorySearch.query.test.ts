import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";
import { memorySearch } from "./memorySearch.query.js";

vi.mock("../../../lib/memory/index.js", () => ({
  getMemoryServices: vi.fn(),
}));

vi.mock("../core/require-user-scope.js", () => ({
  requireMemoryUserScope: vi.fn(),
}));

const getMemoryServicesMock = vi.mocked(getMemoryServices);
const requireMemoryUserScopeMock = vi.mocked(requireMemoryUserScope);

describe("memorySearch requester scope", () => {
  const recallMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    requireMemoryUserScopeMock.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-eric",
    });
    recallMock.mockResolvedValue([
      {
        record: {
          id: "memory-1",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-eric",
          kind: "unit",
          sourceType: "thread_turn",
          status: "active",
          content: {
            text: "Eric prefers concise launch briefs.",
          },
          backendRefs: [{ backend: "agentcore", ref: "user_eric" }],
          createdAt: "2026-05-17T12:00:00.000Z",
          metadata: {},
        },
        score: 0.9,
        backend: "agentcore",
      },
    ]);
    getMemoryServicesMock.mockReturnValue({
      recall: { recall: recallMock },
    } as any);
  });

  it("searches only the resolved requester user's memory", async () => {
    const result = await memorySearch(
      null,
      {
        tenantId: "tenant-1",
        userId: "user-amy",
        query: "launch brief preferences",
        limit: 5,
      },
      {} as any,
    );

    expect(requireMemoryUserScopeMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "user-amy",
        allowTenantAdmin: true,
      }),
    );
    expect(recallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        ownerType: "user",
        ownerId: "user-eric",
        query: "launch brief preferences",
        limit: 5,
        requestContext: {
          contextClass: "memory_search",
          requesterUserId: "user-eric",
          sourceSurface: "graphql.memorySearch",
        },
      }),
    );
    expect(result.records[0]).toMatchObject({
      memoryRecordId: "memory-1",
      namespace: "user_user-eric",
    });
  });

  it("narrows the results to the requested strategy facet", async () => {
    recallMock.mockResolvedValue([
      {
        record: {
          id: "memory-semantic",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-eric",
          kind: "unit",
          sourceType: "thread_turn",
          strategy: "semantic",
          status: "active",
          content: { text: "Eric ships on Fridays." },
          backendRefs: [{ backend: "agentcore", ref: "memory-semantic" }],
          createdAt: "2026-07-25T12:00:00.000Z",
          metadata: {},
        },
        score: 0.9,
        backend: "agentcore",
      },
      {
        record: {
          id: "memory-pref",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-eric",
          kind: "unit",
          sourceType: "thread_turn",
          strategy: "preferences",
          status: "active",
          content: { text: "Prefers dark mode." },
          backendRefs: [{ backend: "agentcore", ref: "memory-pref" }],
          createdAt: "2026-07-25T12:00:00.000Z",
          metadata: {},
        },
        score: 0.5,
        backend: "agentcore",
      },
    ]);

    const result = await memorySearch(
      null,
      { tenantId: "tenant-1", query: "dark", strategy: "PREFERENCES" },
      {} as any,
    );

    expect(result.totalCount).toBe(1);
    expect(result.records[0].memoryRecordId).toBe("memory-pref");
  });
});
