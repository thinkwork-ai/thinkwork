import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireSpaceMemoryScope } from "./space-memory-scope.js";
import { captureSpaceMemory } from "./captureSpaceMemory.mutation.js";
import { spaceMemorySearch } from "./spaceMemorySearch.query.js";

vi.mock("../../../lib/memory/index.js", () => ({
  getMemoryServices: vi.fn(),
}));

vi.mock("./space-memory-scope.js", () => ({
  requireSpaceMemoryScope: vi.fn(),
}));

const getMemoryServicesMock = vi.mocked(getMemoryServices);
const requireSpaceMemoryScopeMock = vi.mocked(requireSpaceMemoryScope);

describe("space memory resolvers", () => {
  const retainMock = vi.fn();
  const recallMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    requireSpaceMemoryScopeMock.mockResolvedValue({
      tenantId: "tenant-1",
      spaceId: "space-1",
      requesterUserId: "user-1",
    });
    retainMock.mockResolvedValue({
      record: {
        id: "space-memory-1",
        tenantId: "tenant-1",
        ownerType: "space",
        ownerId: "space-1",
        kind: "unit",
        sourceType: "explicit_remember",
        status: "active",
        content: { text: "Use the enterprise onboarding template." },
        backendRefs: [{ backend: "cognee", ref: "space-memory-1" }],
        createdAt: "2026-06-26T19:00:00.000Z",
        metadata: {},
      },
      backend: "cognee",
    });
    recallMock.mockResolvedValue([
      {
        record: {
          id: "space-hit-1",
          tenantId: "tenant-1",
          ownerType: "space",
          ownerId: "space-1",
          kind: "unit",
          sourceType: "import",
          status: "active",
          content: { text: "Use the enterprise onboarding template." },
          backendRefs: [{ backend: "cognee", ref: "space-dataset" }],
          createdAt: "2026-06-26T19:00:00.000Z",
          metadata: {},
        },
        score: 0.92,
        backend: "cognee",
      },
    ]);
    getMemoryServicesMock.mockReturnValue({
      adapter: { kind: "cognee", retain: retainMock },
      recall: { recall: recallMock },
    } as any);
  });

  it("captures explicit memories into the authorized space owner", async () => {
    const result = await captureSpaceMemory(
      null,
      {
        tenantId: "tenant-1",
        spaceId: "space-1",
        content: " Use the enterprise onboarding template. ",
        metadata: JSON.stringify({ topic: "onboarding" }),
        clientCaptureId: "capture-1",
      },
      {} as any,
    );

    expect(requireSpaceMemoryScopeMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ tenantId: "tenant-1", spaceId: "space-1" }),
    );
    expect(retainMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        ownerType: "space",
        ownerId: "space-1",
        sourceType: "explicit_remember",
        content: "Use the enterprise onboarding template.",
        metadata: expect.objectContaining({
          topic: "onboarding",
          capture_source: "space_memory_capture",
          captured_by_user_id: "user-1",
          client_capture_id: "capture-1",
        }),
      }),
    );
    expect(result).toMatchObject({
      memoryRecordId: "space-memory-1",
      namespace: "space_space-1",
      content: { text: "Use the enterprise onboarding template." },
    });
  });

  it("searches only the authorized space owner", async () => {
    const result = await spaceMemorySearch(
      null,
      {
        tenantId: "tenant-1",
        spaceId: "space-1",
        query: "onboarding template",
        limit: 5,
      },
      {} as any,
    );

    expect(recallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        ownerType: "space",
        ownerId: "space-1",
        query: "onboarding template",
        limit: 5,
        requestContext: {
          contextClass: "space_memory_search",
          requesterUserId: "user-1",
          sourceSurface: "graphql.spaceMemorySearch",
        },
      }),
    );
    expect(result).toEqual({
      records: [
        expect.objectContaining({
          memoryRecordId: "space-hit-1",
          namespace: "space_space-1",
          score: 0.92,
        }),
      ],
      totalCount: 1,
    });
  });

  it("fails closed when the active engine is not Cognee", async () => {
    getMemoryServicesMock.mockReturnValue({
      adapter: { kind: "hindsight", retain: retainMock },
      recall: { recall: recallMock },
    } as any);

    await expect(
      captureSpaceMemory(
        null,
        {
          tenantId: "tenant-1",
          spaceId: "space-1",
          content: "Use the enterprise onboarding template.",
        },
        {} as any,
      ),
    ).rejects.toThrow("Space memory requires the Cognee memory engine");
    await expect(
      spaceMemorySearch(
        null,
        {
          tenantId: "tenant-1",
          spaceId: "space-1",
          query: "onboarding",
        },
        {} as any,
      ),
    ).rejects.toThrow("Space memory requires the Cognee memory engine");
  });
});
