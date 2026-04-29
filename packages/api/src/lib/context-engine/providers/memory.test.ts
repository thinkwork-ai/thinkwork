import { beforeEach, describe, expect, it, vi } from "vitest";

const reflectMock = vi.hoisted(() => vi.fn());
const recallMock = vi.hoisted(() => vi.fn());

vi.mock("../../memory/index.js", () => ({
  getMemoryServices: () => ({
    adapter: {
      reflect: reflectMock,
    },
    recall: {
      recall: recallMock,
    },
  }),
}));

describe("memory context provider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    reflectMock.mockReset();
    recallMock.mockReset();
  });

  it("uses reflection text as the Context Engine snippet", async () => {
    vi.stubEnv("CONTEXT_ENGINE_MEMORY_QUERY_MODE", "reflect");
    reflectMock.mockResolvedValueOnce([
      {
        record: {
          id: "reflection-1",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-1",
          kind: "reflection",
          sourceType: "system_reflection",
          status: "active",
          content: {
            summary: "Hindsight reflection",
            text: "Smoke test activity involved Codex, MCP checks, and wiki search.",
          },
          backendRefs: [{ backend: "hindsight", ref: "user_user-1" }],
          createdAt: "2026-04-29T00:00:00.000Z",
          metadata: {},
        },
        score: 1,
        backend: "hindsight",
      },
    ]);

    const { createMemoryContextProvider } = await import("./memory.js");
    const provider = createMemoryContextProvider();
    const result = await provider.query({
      query: "Smoke Tests 27 April 2026",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 10,
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(reflectMock).toHaveBeenCalledTimes(1);
    expect(recallMock).not.toHaveBeenCalled();
    expect(result.hits[0]).toMatchObject({
      title: "Hindsight reflection",
      snippet:
        "Smoke test activity involved Codex, MCP checks, and wiki search.",
      provenance: {
        metadata: expect.objectContaining({ mode: "reflect" }),
      },
    });
  });
});
