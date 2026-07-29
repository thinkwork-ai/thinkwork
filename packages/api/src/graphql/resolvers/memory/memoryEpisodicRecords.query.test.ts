import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";
import { memoryEpisodicRecords } from "./memoryEpisodicRecords.query.js";

vi.mock("../../../lib/memory/index.js", () => ({
  getMemoryServices: vi.fn(),
}));

vi.mock("../core/require-user-scope.js", () => ({
  requireMemoryUserScope: vi.fn(),
}));

const getMemoryServicesMock = vi.mocked(getMemoryServices);
const requireMemoryUserScopeMock = vi.mocked(requireMemoryUserScope);

const inspectEpisodicMock = vi.fn();

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "episode-1",
    tenantId: "tenant-1",
    ownerType: "user",
    ownerId: "user-eric",
    kind: "unit",
    sourceType: "thread_turn",
    strategy: "episodes",
    status: "active",
    content: { text: "Shipped the memory page." },
    backendRefs: [{ backend: "agentcore", ref: "episode-1" }],
    createdAt: "2026-07-25T12:00:00.000Z",
    metadata: { namespace: "episodes_user-eric/session-9" },
    ...overrides,
  };
}

describe("memoryEpisodicRecords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireMemoryUserScopeMock.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-eric",
    });
    inspectEpisodicMock.mockResolvedValue([record()]);
    getMemoryServicesMock.mockReturnValue({
      inspect: { inspectEpisodic: inspectEpisodicMock },
    } as any);
  });

  it("reads the episodic facet for the resolved user scope", async () => {
    const rows = await memoryEpisodicRecords(
      null,
      { tenantId: "tenant-1", userId: "user-eric", limit: 25 },
      {} as any,
    );

    expect(inspectEpisodicMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      ownerType: "user",
      ownerId: "user-eric",
      limit: 25,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].memoryRecordId).toBe("episode-1");
    expect(rows[0].strategy).toBe("episodes");
    expect(rows[0].namespace).toBe("episodes_user-eric/session-9");
  });

  it("allows tenant admins to read another member's episodes", async () => {
    await memoryEpisodicRecords(
      null,
      { tenantId: "tenant-1", userId: "user-amy" },
      {} as any,
    );
    expect(requireMemoryUserScopeMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "user-amy", allowTenantAdmin: true }),
    );
  });

  it("caps the requested limit at the total cap", async () => {
    await memoryEpisodicRecords(null, { limit: 5000 }, {} as any);
    expect(inspectEpisodicMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 }),
    );
  });

  it("returns an empty list when the engine has no episodic facet", async () => {
    inspectEpisodicMock.mockResolvedValue([]);
    const rows = await memoryEpisodicRecords(null, {}, {} as any);
    expect(rows).toEqual([]);
  });
});
