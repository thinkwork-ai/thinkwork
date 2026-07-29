import { describe, expect, it, vi } from "vitest";

import { buildInvocationResources } from "../src/server.js";
import { HandleStore } from "../src/mcp.js";
import { McpToolRegistry } from "../src/mcp-registry.js";
import { IDENTITY_RESOLUTION_TOOL_NAMES } from "@thinkwork/pi-extensions";
import {
  ApiIdentityResolutionProviderError,
  createApiIdentityResolutionProvider,
} from "../src/runtime/providers/identity-resolution-provider.js";

/**
 * THINK-321 U5 — identity-resolution wiring guards.
 *
 * 1. Allowlist fold (the known dark-tool trap): every declared tool name
 *    must land in `bundle.extensionToolNames` when the payload flag +
 *    wiring gate is satisfied, and none when the flag is off or the turn
 *    is eval mode.
 * 2. Provider transport: turn-bound header, no tenant assertion, single
 *    attempt with a snapshot credential, typed errors.
 */

function baseArgs(
  overrides: {
    payload?: Record<string, unknown>;
    identity?: Partial<{
      tenantId: string;
      userId: string;
      agentId: string;
      threadId: string;
    }>;
  } = {},
) {
  return {
    payload: {
      tenant_id: "tenant-1",
      user_id: "user-1",
      assistant_id: "agent-1",
      thread_id: "thread-1",
      message: "hello",
      thinkwork_api_url: "https://api.example.com",
      thinkwork_api_secret: "test-secret-do-not-leak",
      thread_turn_id: "7c1f8a8e-1c1d-4e58-9a8e-0b1c2d3e4f5a",
      ...(overrides.payload ?? {}),
    },
    identity: {
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      threadId: "thread-1",
      tenantSlug: "",
      agentSlug: "",
      traceId: "",
      ...(overrides.identity ?? {}),
    },
    env: {
      awsRegion: "us-east-1",
      agentCoreMemoryId: "",
      memoryEngine: "agentcore" as const,
      memoryRetainFnName: "",
      dbClusterArn: "",
      dbSecretArn: "",
      dbName: "thinkwork",
      workspaceBucket: "",
      workspaceDir: "/tmp/workspace",
      piAgentDir: "/tmp/thinkwork-pi-agent",
      gitSha: "test",
    },
    agentCoreClient: {} as never,
    workspaceSkills: [],
    connectMcpServer: async () => [],
    sessionStoreFactory: () => ({}) as never,
    cleanup: [],
    handleStore: new HandleStore(),
    mcpJsonConfig: { directTools: [] },
    mcpRegistry: new McpToolRegistry(),
  };
}

describe("buildInvocationResources — identity-resolution extension allowlist", () => {
  it("folds all three identity tools into the activation allowlist when the payload flag is on", async () => {
    const bundle = await buildInvocationResources(
      baseArgs({
        payload: { identity_resolution_enabled: true },
      }) as never,
    );
    for (const name of IDENTITY_RESOLUTION_TOOL_NAMES) {
      expect(bundle.extensionToolNames).toContain(name);
      // Extension tools, not plain AgentTools.
      expect(bundle.tools.map((tool) => tool.name)).not.toContain(name);
    }
    bundle.handleStore.clear();
  });

  it("registers no identity tools when the payload flag is off", async () => {
    const bundle = await buildInvocationResources(baseArgs() as never);
    for (const name of IDENTITY_RESOLUTION_TOOL_NAMES) {
      expect(bundle.extensionToolNames).not.toContain(name);
    }
    bundle.handleStore.clear();
  });

  it("registers no identity tools in eval mode (user-less)", async () => {
    const bundle = await buildInvocationResources(
      baseArgs({
        payload: { identity_resolution_enabled: true, eval_mode: true },
      }) as never,
    );
    for (const name of IDENTITY_RESOLUTION_TOOL_NAMES) {
      expect(bundle.extensionToolNames).not.toContain(name);
    }
    bundle.handleStore.clear();
  });

  it("skips registration (missing-wiring path) when the API url/secret are absent", async () => {
    const bundle = await buildInvocationResources(
      baseArgs({
        payload: {
          identity_resolution_enabled: true,
          thinkwork_api_url: "",
          thinkwork_api_secret: "",
        },
      }) as never,
    );
    for (const name of IDENTITY_RESOLUTION_TOOL_NAMES) {
      expect(bundle.extensionToolNames).not.toContain(name);
    }
    bundle.handleStore.clear();
  });
});

// ---------------------------------------------------------------------------
// Provider transport
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const baseOptions = {
  apiUrl: "https://api.dev.example.com",
  apiSecret: "service-secret",
  threadTurnId: "7c1f8a8e-1c1d-4e58-9a8e-0b1c2d3e4f5a",
};

const resolvePayload = {
  data: {
    resolveEntities: {
      results: [
        {
          status: "hit",
          unroutable: null,
          entity: {
            canonicalEntityId: "ce-1",
            displayName: "Acme Fuel",
            entityTypeSlug: "customer",
            mappings: [
              {
                sourceSystem: "lastmile",
                namespace: "",
                externalId: "CUST-42",
                connectorSlug: "lastmile-db",
                fetchable: true,
                unroutableReason: null,
                createdBy: "rule",
                createdByUserId: null,
                createdThreadRef: null,
                createdAt: "2026-07-19T00:00:00.000Z",
                caveat: "matched",
                confidence: 0.92,
              },
            ],
          },
        },
        { status: "miss", unroutable: "not_found", entity: null },
      ],
      page: 0,
      limit: 200,
      totalRefs: 2,
      hasMore: false,
    },
  },
};

describe("createApiIdentityResolutionProvider", () => {
  it("throws at construction when wiring is incomplete (snapshot-at-entry, fail loud)", () => {
    expect(() =>
      createApiIdentityResolutionProvider({ ...baseOptions, apiUrl: "" }),
    ).toThrow(/apiUrl/);
    expect(() =>
      createApiIdentityResolutionProvider({ ...baseOptions, apiSecret: "" }),
    ).toThrow(/apiSecret/);
    expect(() =>
      createApiIdentityResolutionProvider({
        apiUrl: baseOptions.apiUrl,
        apiSecret: baseOptions.apiSecret,
      }),
    ).toThrow(/turn-bound reference/);
  });

  it("posts the GraphQL query to /graphql with the snapshotted bearer + turn-bound header and NO tenant assertion", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(resolvePayload));
    const provider = createApiIdentityResolutionProvider({
      ...baseOptions,
      fetchImpl,
    });

    const result = await provider.resolveEntities({
      refs: [
        { canonicalId: "ce-1" },
        { sourceSystem: "lastmile", externalId: "CUST-9" },
      ],
      targetSystems: ["twenty"],
      page: 0,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.dev.example.com/graphql");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer service-secret");
    expect(headers["x-thread-turn-id"]).toBe(baseOptions.threadTurnId);
    // The provider never asserts a tenant — the API derives it server-side
    // from the turn reference (KTD-1).
    expect(headers["x-tenant-id"]).toBeUndefined();
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.query).toContain("resolveEntities");
    expect(body.variables.refs).toEqual([
      { canonicalId: "ce-1" },
      { sourceSystem: "lastmile", namespace: null, externalId: "CUST-9" },
    ]);
    expect(body.variables.targetSystems).toEqual(["twenty"]);

    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.status).toBe("hit");
    expect(result.results[0]!.entity!.mappings[0]!.connectorSlug).toBe(
      "lastmile-db",
    );
    expect(result.results[1]).toEqual({
      status: "miss",
      unroutable: "not_found",
      entity: null,
    });
    expect(result.hasMore).toBe(false);
  });

  it("falls back to x-thread-id when no turn id is available", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(resolvePayload));
    const provider = createApiIdentityResolutionProvider({
      apiUrl: baseOptions.apiUrl,
      apiSecret: baseOptions.apiSecret,
      threadId: "thread-1",
      fetchImpl,
    });
    await provider.resolveEntities({ refs: [{ canonicalId: "ce-1" }] });
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["x-thread-id"]).toBe("thread-1");
    expect(headers["x-thread-turn-id"]).toBeUndefined();
  });

  it("parses propose candidates through the AWSJSON dual wire shape (string or array)", async () => {
    const candidates = [
      {
        id: "cand-1",
        sourceSystem: "twenty",
        namespace: "",
        externalId: "co-7",
        matchedKeyKinds: ["name"],
        normalizedValues: { name: "acme fuel" },
        confidence: 0.9,
      },
    ];
    for (const wireCandidates of [candidates, JSON.stringify(candidates)]) {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            proposeMappingCandidates: {
              status: "proposed",
              reason: null,
              candidateSetId: "set-1",
              candidates: wireCandidates,
              expiresAt: "2026-07-20T00:00:00.000Z",
            },
          },
        }),
      );
      const provider = createApiIdentityResolutionProvider({
        ...baseOptions,
        fetchImpl,
      });
      const result = await provider.proposeMappingCandidates({
        canonicalEntityId: "ce-1",
        targetSystem: "twenty",
      });
      expect(result).toEqual({
        status: "proposed",
        candidateSetId: "set-1",
        candidates,
        expiresAt: "2026-07-20T00:00:00.000Z",
      });
    }
  });

  it("maps confirm outcomes (confirmed / already_linked / refused) to typed results", async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [
        {
          status: "confirmed",
          mappingId: "map-1",
          canonicalEntityId: "ce-1",
          sourceSystem: "twenty",
          namespace: "",
          externalId: "co-7",
        },
        {
          status: "confirmed",
          mappingId: "map-1",
          canonicalEntityId: "ce-1",
          sourceSystem: "twenty",
          namespace: "",
          externalId: "co-7",
        },
      ],
      [
        {
          status: "already_linked",
          existingMappingId: "map-9",
          existingCanonicalEntityId: "ce-9",
        },
        {
          status: "already_linked",
          existingMappingId: "map-9",
          existingCanonicalEntityId: "ce-9",
        },
      ],
      [
        { status: "refused", reason: "no_selection_recorded" },
        { status: "refused", reason: "no_selection_recorded" },
      ],
    ];
    for (const [wire, expected] of cases) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ data: { confirmEntityMapping: wire } }),
        );
      const provider = createApiIdentityResolutionProvider({
        ...baseOptions,
        fetchImpl,
      });
      const result = await provider.confirmMapping({
        candidateSetId: "set-1",
        candidateId: "cand-1",
      });
      expect(result).toEqual(expected);
    }
  });

  it("passes declineCandidates through (the U6 reject-all path)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          declineEntityMappingCandidates: {
            status: "declined",
            caseId: "case-1",
            coalesced: true,
          },
        },
      }),
    );
    const provider = createApiIdentityResolutionProvider({
      ...baseOptions,
      fetchImpl,
    });
    const result = await provider.declineCandidates({
      candidateSetId: "set-1",
    });
    expect(result).toEqual({
      status: "declined",
      caseId: "case-1",
      coalesced: true,
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.query).toContain("declineEntityMappingCandidates");
  });

  it("surfaces GraphQL errors and non-OK responses as typed provider errors (single attempt)", async () => {
    const errorFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        errors: [{ message: "Access denied: tenant mismatch" }],
      }),
    );
    const provider = createApiIdentityResolutionProvider({
      ...baseOptions,
      fetchImpl: errorFetch,
    });
    await expect(
      provider.resolveEntities({ refs: [{ canonicalId: "ce-1" }] }),
    ).rejects.toThrow(ApiIdentityResolutionProviderError);
    expect(errorFetch).toHaveBeenCalledTimes(1);

    const httpFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "boom" }, 502));
    const provider2 = createApiIdentityResolutionProvider({
      ...baseOptions,
      fetchImpl: httpFetch,
    });
    await expect(
      provider2.resolveEntities({ refs: [{ canonicalId: "ce-1" }] }),
    ).rejects.toThrow(/Identity resolution API 502/);
    // Single attempt — no retry ladder for an in-turn tool.
    expect(httpFetch).toHaveBeenCalledTimes(1);
  });
});
