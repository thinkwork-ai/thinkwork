import { beforeEach, describe, expect, it, vi } from "vitest";

const reflectMock = vi.hoisted(() => vi.fn());
const recallMock = vi.hoisted(() => vi.fn());
const findPageSourcesAcrossSurfacesMock = vi.hoisted(() => vi.fn());

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

vi.mock("../../brain/repository.js", () => ({
  findPageSourcesAcrossSurfaces: findPageSourcesAcrossSurfacesMock,
}));

describe("memory context provider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    reflectMock.mockReset();
    recallMock.mockReset();
    findPageSourcesAcrossSurfacesMock.mockReset();
    findPageSourcesAcrossSurfacesMock.mockResolvedValue([]);
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

  it("lets request options override the server memory query mode", async () => {
    vi.stubEnv("CONTEXT_ENGINE_MEMORY_QUERY_MODE", "recall");
    reflectMock.mockResolvedValueOnce([
      {
        record: {
          id: "reflection-override",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-1",
          kind: "reflection",
          sourceType: "system_reflection",
          status: "active",
          content: {
            summary: "Override reflection",
            text: "Reflect was selected for this test run.",
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
      providerOptions: { memory: { queryMode: "reflect" } },
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(reflectMock).toHaveBeenCalledTimes(1);
    expect(recallMock).not.toHaveBeenCalled();
    expect(result.hits[0]?.provenance.metadata).toMatchObject({
      mode: "reflect",
    });
  });

  it("uses recall when request options override a reflect server default", async () => {
    vi.stubEnv("CONTEXT_ENGINE_MEMORY_QUERY_MODE", "reflect");
    recallMock.mockResolvedValueOnce([
      {
        record: {
          id: "memory-override",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-1",
          kind: "semantic",
          sourceType: "conversation",
          status: "active",
          content: {
            summary: "Favorite restaurant",
            text: "Auberge Bressane is a favorite restaurant in Paris.",
          },
          backendRefs: [{ backend: "hindsight", ref: "user_user-1" }],
          createdAt: "2026-04-29T00:00:00.000Z",
          metadata: {},
        },
        score: 0.8,
        backend: "hindsight",
      },
    ]);

    const { createMemoryContextProvider } = await import("./memory.js");
    const provider = createMemoryContextProvider();
    const result = await provider.query({
      query: "favorite restaurant in paris",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 10,
      providerOptions: { memory: { queryMode: "recall" } },
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(recallMock).toHaveBeenCalledTimes(1);
    expect(reflectMock).not.toHaveBeenCalled();
    expect(result.hits[0]).toMatchObject({
      id: "memory:memory-override",
      title: "Favorite restaurant",
      snippet: "Favorite restaurant",
      provenance: {
        metadata: expect.objectContaining({ mode: "recall" }),
      },
    });
  });

  it("passes requester context to recall and exposes provider status metadata", async () => {
    recallMock.mockResolvedValueOnce([]);

    const { createMemoryContextProvider } = await import("./memory.js");
    const provider = createMemoryContextProvider();
    const result = await provider.query({
      query: "new email from Acme",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 10,
      providerOptions: { memory: { queryMode: "recall" } },
      caller: {
        tenantId: "tenant-1",
        userId: "user-eric",
        requesterContext: {
          contextClass: "personal_connector_event",
          computerId: "computer-sales",
          requesterUserId: "user-eric",
          sourceSurface: "gmail",
          credentialSubject: {
            type: "user",
            userId: "user-eric",
            connectionId: "connection-1",
            provider: "google_workspace",
          },
          event: {
            provider: "gmail",
            eventType: "message.created",
            eventId: "gmail-event-1",
            metadata: { from: "buyer@example.com" },
          },
        },
      },
    });

    expect(recallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: "user",
        ownerId: "user-eric",
        requestContext: expect.objectContaining({
          contextClass: "personal_connector_event",
          computerId: "computer-sales",
          requesterUserId: "user-eric",
          sourceSurface: "gmail",
          event: expect.objectContaining({
            provider: "gmail",
            eventType: "message.created",
          }),
        }),
      }),
    );
    expect(result.status?.metadata).toMatchObject({
      contextClass: "personal_connector_event",
      requesterUserId: "user-eric",
      computerId: "computer-sales",
      sourceSurface: "gmail",
    });
  });

  it("returns compiled wiki pages that cite recalled Hindsight memory units", async () => {
    recallMock.mockResolvedValueOnce([
      {
        record: {
          id: "mem-restaurant",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-1",
          kind: "semantic",
          sourceType: "conversation",
          status: "active",
          content: {
            summary: "Favorite restaurant",
            text: "Auberge Bressane is a favorite restaurant in Paris.",
          },
          backendRefs: [{ backend: "hindsight", ref: "user_user-1" }],
          createdAt: "2026-04-29T00:00:00.000Z",
          metadata: {},
        },
        score: 0.8,
        backend: "hindsight",
      },
    ]);
    findPageSourcesAcrossSurfacesMock.mockResolvedValueOnce([
      {
        pageTable: "wiki_pages",
        pageId: "page-auberge-bressane",
        sectionId: "section-overview",
        sourceKind: "memory_unit",
        sourceRef: "mem-restaurant",
        title: "Auberge Bressane",
        slug: "auberge-bressane",
        entitySubtype: "concept",
      },
    ]);

    const { createMemoryContextProvider } = await import("./memory.js");
    const provider = createMemoryContextProvider();
    const result = await provider.query({
      query: "favorite restaurant in paris",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 10,
      providerOptions: { memory: { queryMode: "recall" } },
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(findPageSourcesAcrossSurfacesMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      ownerId: "user-1",
      sourceKind: "memory_unit",
      sourceRef: "mem-restaurant",
    });
    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "memory:mem-restaurant",
        family: "memory",
      }),
      expect.objectContaining({
        id: "wiki:wiki_pages:page-auberge-bressane:via-memory:mem-restaurant",
        providerId: "memory",
        family: "wiki",
        title: "Auberge Bressane",
        score: 0.9500000000000001,
        provenance: expect.objectContaining({
          sourceId: "page-auberge-bressane",
          uri: "thinkwork://wiki/concept/auberge-bressane",
          metadata: expect.objectContaining({
            bridge: "hindsight-memory-to-wiki",
            memoryUnitId: "mem-restaurant",
          }),
        }),
      }),
    ]);
  });

  it("keeps memory hits when the wiki citation bridge is unavailable", async () => {
    recallMock.mockResolvedValueOnce([
      {
        record: {
          id: "mem-no-bridge",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-1",
          kind: "semantic",
          sourceType: "conversation",
          status: "active",
          content: {
            summary: "Favorite restaurant",
            text: "Auberge Bressane is a favorite restaurant in Paris.",
          },
          backendRefs: [{ backend: "hindsight", ref: "user_user-1" }],
          createdAt: "2026-04-29T00:00:00.000Z",
          metadata: {},
        },
        score: 0.8,
        backend: "hindsight",
      },
    ]);
    findPageSourcesAcrossSurfacesMock.mockRejectedValueOnce(
      new Error("citation lookup failed"),
    );

    const { createMemoryContextProvider } = await import("./memory.js");
    const provider = createMemoryContextProvider();
    const result = await provider.query({
      query: "favorite restaurant in paris",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 10,
      providerOptions: { memory: { queryMode: "recall" } },
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(result.hits).toEqual([
      expect.objectContaining({ id: "memory:mem-no-bridge" }),
    ]);
    expect(result.status).toMatchObject({
      state: "stale",
      reason: "wiki citation bridge failed: citation lookup failed",
    });
  });
});
