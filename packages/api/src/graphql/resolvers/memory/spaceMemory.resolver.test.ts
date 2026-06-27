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
  const capabilitiesMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    capabilitiesMock.mockResolvedValue({
      retain: true,
      recall: true,
      spaceMemory: true,
    });
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
        backendRefs: [{ backend: "hindsight", ref: "space-memory-1" }],
        createdAt: "2026-06-26T19:00:00.000Z",
        metadata: {},
      },
      backend: "hindsight",
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
          backendRefs: [{ backend: "hindsight", ref: "space-bank" }],
          createdAt: "2026-06-26T19:00:00.000Z",
          metadata: {},
        },
        score: 0.92,
        backend: "hindsight",
      },
    ]);
    getMemoryServicesMock.mockReturnValue({
      adapter: {
        kind: "hindsight",
        retain: retainMock,
        capabilities: capabilitiesMock,
      },
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

  it("keeps Space A and Space B search results isolated by owner", async () => {
    recallMock.mockImplementation(async (request) => {
      const token =
        request.ownerId === "space-a"
          ? "thnk-83-space-a-only"
          : "thnk-83-space-b-only";
      return [
        {
          record: {
            id: `${request.ownerId}-hit`,
            tenantId: request.tenantId,
            ownerType: "space",
            ownerId: request.ownerId,
            kind: "unit",
            sourceType: "explicit_remember",
            status: "active",
            content: { text: `Memory token ${token}` },
            backendRefs: [{ backend: "hindsight", ref: request.ownerId }],
            createdAt: "2026-06-27T12:00:00.000Z",
            metadata: { bankId: `space_${request.ownerId}` },
          },
          score: 0.99,
          backend: "hindsight",
        },
      ];
    });

    requireSpaceMemoryScopeMock
      .mockResolvedValueOnce({
        tenantId: "tenant-1",
        spaceId: "space-a",
        requesterUserId: "user-1",
      })
      .mockResolvedValueOnce({
        tenantId: "tenant-1",
        spaceId: "space-b",
        requesterUserId: "user-1",
      });

    const spaceA = await spaceMemorySearch(
      null,
      {
        tenantId: "tenant-1",
        spaceId: "space-a",
        query: "thnk-83-space-a-only",
        limit: 5,
      },
      {} as any,
    );
    const spaceB = await spaceMemorySearch(
      null,
      {
        tenantId: "tenant-1",
        spaceId: "space-b",
        query: "thnk-83-space-b-only",
        limit: 5,
      },
      {} as any,
    );

    expect(recallMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ownerId: "space-a" }),
    );
    expect(recallMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ownerId: "space-b" }),
    );
    expect(JSON.stringify(spaceA)).toContain("thnk-83-space-a-only");
    expect(JSON.stringify(spaceA)).not.toContain("thnk-83-space-b-only");
    expect(JSON.stringify(spaceB)).toContain("thnk-83-space-b-only");
    expect(JSON.stringify(spaceB)).not.toContain("thnk-83-space-a-only");
  });

  it("fails closed when the active engine lacks Space memory capability", async () => {
    capabilitiesMock.mockResolvedValue({
      retain: true,
      recall: true,
      spaceMemory: false,
    });
    getMemoryServicesMock.mockReturnValue({
      adapter: {
        kind: "agentcore",
        retain: retainMock,
        capabilities: capabilitiesMock,
      },
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
    ).rejects.toThrow(
      "Active memory engine does not support Space memory capture",
    );
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
    ).rejects.toThrow(
      "Active memory engine does not support Space memory search",
    );
  });
});
