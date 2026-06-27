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
      backend: "hindsight",
    });
    getMemoryServicesMock.mockReturnValue({
      adapter: { retain: retainMock },
    } as any);
  });

  it("sends mobile quick captures with first-class Hindsight retain params", async () => {
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
        hindsight: expect.objectContaining({
          tags: [
            "source:mobile-capture",
            "surface:mobile",
            "surface:graphql",
            "scope:personal",
            "scope:explicit-memory",
          ],
          documentTags: ["source:mobile-capture", "scope:explicit-memory"],
          observationScopes: [
            ["source:mobile-capture"],
            ["scope:explicit-memory"],
          ],
        }),
        metadata: expect.objectContaining({
          topic: "style",
          capture_source: "mobile_quick_capture",
          client_capture_id: "capture-1",
          fact_type_override: "opinion",
          captured_at: expect.any(String),
        }),
      }),
    );
    const call = retainMock.mock.calls[0]?.[0];
    expect(call.hindsight.timestamp).toBe(call.metadata.captured_at);
    expect(result).toMatchObject({
      id: "memory-1",
      userId: "user-1",
      content: "Prefer concise summaries.",
      factType: "PREFERENCE",
    });
  });
});
