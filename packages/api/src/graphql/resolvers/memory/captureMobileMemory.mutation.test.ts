import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";
import { captureMobileMemory } from "./captureMobileMemory.mutation.js";

vi.mock("../../../lib/memory/index.js", () => ({
  getMemoryServices: vi.fn(),
}));

vi.mock("../core/require-user-scope.js", () => ({
  requireMemoryUserScope: vi.fn(),
}));

const getMemoryServicesMock = vi.mocked(getMemoryServices);
const requireMemoryUserScopeMock = vi.mocked(requireMemoryUserScope);

describe("captureMobileMemory", () => {
  const retainMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    requireMemoryUserScopeMock.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-1",
    });
    retainMock.mockResolvedValue({
      record: {
        id: "memory-1",
        content: { text: "Prefer concise summaries." },
      },
      backend: "agentcore",
    });
    getMemoryServicesMock.mockReturnValue({
      adapter: { retain: retainMock },
    } as any);
  });

  it("sends mobile quick captures through the memory adapter retain", async () => {
    const result = await captureMobileMemory(
      null,
      {
        content: " Prefer concise summaries. ",
        factType: "PREFERENCE",
        metadata: { topic: "style" },
        clientCaptureId: "capture-1",
      },
      {} as any,
    );

    expect(retainMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        ownerType: "user",
        ownerId: "user-1",
        sourceType: "explicit_remember",
        content: "Prefer concise summaries.",
        role: "user",
        metadata: expect.objectContaining({
          topic: "style",
          capture_source: "mobile_quick_capture",
          client_capture_id: "capture-1",
          fact_type_override: "opinion",
          captured_at: expect.any(String),
        }),
      }),
    );
    expect(result).toMatchObject({
      id: "memory-1",
      userId: "user-1",
      content: "Prefer concise summaries.",
      factType: "PREFERENCE",
    });
  });
});
