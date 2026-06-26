import { beforeEach, describe, expect, it, vi } from "vitest";

const reflectMock = vi.hoisted(() => vi.fn());
const recallMock = vi.hoisted(() => vi.fn());
const findPageSourcesAcrossSurfacesMock = vi.hoisted(() => vi.fn());

vi.mock("../../memory/index.js", () => ({
  getMemoryServices: () => ({
    adapter: {
      kind: "cognee",
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
      id: "memory:user:memory-override",
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

  it("recalls user and space memory when auto scope has both owners", async () => {
    recallMock
      .mockResolvedValueOnce([
        {
          record: {
            id: "user-memory",
            tenantId: "tenant-1",
            ownerType: "user",
            ownerId: "user-eric",
            kind: "unit",
            sourceType: "thread_turn",
            status: "active",
            content: {
              summary: "Brief preference",
              text: "Eric prefers concise launch briefs.",
            },
            backendRefs: [{ backend: "cognee", ref: "user-dataset" }],
            createdAt: "2026-06-26T19:00:00.000Z",
            metadata: {},
          },
          score: 0.7,
          backend: "cognee",
        },
      ])
      .mockResolvedValueOnce([
        {
          record: {
            id: "space-memory",
            tenantId: "tenant-1",
            ownerType: "space",
            ownerId: "space-sales",
            kind: "unit",
            sourceType: "explicit_remember",
            status: "active",
            content: {
              text: "The sales space uses the enterprise onboarding template.",
            },
            backendRefs: [{ backend: "cognee", ref: "space-dataset" }],
            createdAt: "2026-06-26T19:01:00.000Z",
            metadata: {},
          },
          score: 0.9,
          backend: "cognee",
        },
      ]);

    const { createMemoryContextProvider } = await import("./memory.js");
    const provider = createMemoryContextProvider();
    const result = await provider.query({
      query: "launch onboarding",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 10,
      providerOptions: { memory: { queryMode: "recall" } },
      caller: {
        tenantId: "tenant-1",
        userId: "user-eric",
        spaceId: "space-sales",
      },
    });

    expect(recallMock).toHaveBeenCalledTimes(2);
    expect(recallMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ownerType: "user",
        ownerId: "user-eric",
      }),
    );
    expect(recallMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ownerType: "space",
        ownerId: "space-sales",
        requestContext: expect.objectContaining({
          requesterUserId: "user-eric",
        }),
      }),
    );
    expect(result.hits).toEqual([
      expect.objectContaining({
        id: "memory:space:space-memory",
        title: "Space Memory",
        provenance: expect.objectContaining({
          label: "Space Memory",
          metadata: expect.objectContaining({ ownerType: "space" }),
        }),
        metadata: expect.objectContaining({
          ownerType: "space",
          ownerId: "space-sales",
        }),
      }),
      expect.objectContaining({
        id: "memory:user:user-memory",
        title: "Brief preference",
      }),
    ]);
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
        id: "memory:user:mem-restaurant",
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

  it("marks bridged tenant entity pages as Brain source-family hits", async () => {
    recallMock.mockResolvedValueOnce([
      {
        record: {
          id: "mem-acme",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-1",
          kind: "semantic",
          sourceType: "conversation",
          status: "active",
          content: {
            summary: "Acme commitment",
            text: "Acme needs the renewal pricing before Tuesday.",
          },
          backendRefs: [{ backend: "hindsight", ref: "user_user-1" }],
          createdAt: "2026-05-17T00:00:00.000Z",
          metadata: {},
        },
        score: 0.8,
        backend: "hindsight",
      },
    ]);
    findPageSourcesAcrossSurfacesMock.mockResolvedValueOnce([
      {
        pageTable: "tenant_entity_pages",
        pageId: "page-acme",
        sectionId: "section-commitments",
        sourceKind: "memory_unit",
        sourceRef: "mem-acme",
        title: "Acme",
        slug: "acme",
        entitySubtype: "customer",
      },
    ]);

    const { createMemoryContextProvider } = await import("./memory.js");
    const provider = createMemoryContextProvider();
    const result = await provider.query({
      query: "Acme renewal pricing",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 10,
      providerOptions: { memory: { queryMode: "recall" } },
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(result.hits[1]).toMatchObject({
      id: "wiki:tenant_entity_pages:page-acme:via-memory:mem-acme",
      family: "wiki",
      sourceFamily: "brain",
      provenance: {
        uri: "thinkwork://brain/customer/acme",
        metadata: expect.objectContaining({
          pageTable: "tenant_entity_pages",
          entitySubtype: "customer",
        }),
      },
    });
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
      expect.objectContaining({ id: "memory:user:mem-no-bridge" }),
    ]);
    expect(result.status).toMatchObject({
      state: "stale",
      reason: "wiki citation bridge failed: citation lookup failed",
    });
  });
});
