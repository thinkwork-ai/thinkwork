import { describe, expect, it, vi } from "vitest";
import {
  brainLikePattern,
  buildBrainPrefixTsQuery,
  createCompanyBrainContextProvider,
  normalizeBrainSearchTerms,
} from "./company-brain.js";
import type { ContextEngineProviderRequest } from "../types.js";

const readySubstrate = {
  id: "substrate-1",
  tenant_id: "tenant-1",
  storage_tier: "default",
  active_backend: "default",
  status: "ready",
  health_status: "healthy",
  launch_capabilities: {
    retrieval: { status: "enabled", source: "dogfood-smoke" },
    provenance: { status: "enabled", source: "artifact-manifests" },
  },
  graph_provider: "cognee",
  vector_provider: "lancedb",
  embedding_model: "amazon.titan-embed-text-v2:0",
  vector_dimension: 1024,
  cognee_version: "1.0.0",
  latest_ingest_at: new Date("2026-06-14T10:00:00.000Z"),
  latest_projection_at: new Date("2026-06-14T10:05:00.000Z"),
  updated_at: new Date("2026-06-14T10:06:00.000Z"),
};

const request: ContextEngineProviderRequest = {
  query: "Acme renewal risk",
  mode: "results",
  scope: "team",
  depth: "quick",
  limit: 5,
  caller: { tenantId: "tenant-1", userId: "user-1" },
};

describe("Company Brain Context Engine provider", () => {
  it("returns active substrate Brain hits with bounded provenance", async () => {
    const provider = createCompanyBrainContextProvider({
      loadSubstrateState: async () => readySubstrate,
      searchPages: async () => [
        {
          id: "page-acme",
          type: "entity",
          entity_subtype: "customer",
          slug: "acme",
          title: "Acme",
          summary:
            "Acme renewal is at risk because procurement has a new approval step.",
          body_md: null,
          last_compiled_at: new Date("2026-06-14T09:00:00.000Z"),
          updated_at: new Date("2026-06-14T09:30:00.000Z"),
          score: 0.92,
        },
      ],
      loadArtifactManifests: async () => [
        {
          id: "manifest-source",
          manifest_kind: "source_artifact",
          storage_tier: "default",
          source_family: "thread",
          source_kind: "thread",
          source_type: "thread_message",
          source_id_hash: "hash-abc",
          object_count: 1,
          source_count: 3,
          checksum_sha256: "checksum",
          status: "active",
          metadata: {},
          updated_at: new Date("2026-06-14T09:10:00.000Z"),
        },
        {
          id: "manifest-vault",
          manifest_kind: "vault_projection",
          storage_tier: "default",
          source_family: "wiki",
          source_kind: "wiki",
          source_type: "wiki_vault_projection",
          source_id_hash: "hash-vault",
          object_count: 1,
          source_count: 1,
          checksum_sha256: "checksum-vault",
          status: "active",
          metadata: {},
          updated_at: new Date("2026-06-14T09:20:00.000Z"),
        },
      ],
    });

    const result = await provider.query({
      ...request,
      providerOptions: {
        brain: {
          sourceKind: "thread",
          datasetId: "dogfood-renewal",
          nodeSetIds: ["customer-success"],
          onlyContext: true,
        },
      },
    });

    expect(result.status).toMatchObject({
      state: "ok",
      metadata: {
        activeBackend: "default",
        retrievalOptions: {
          sourceKind: "thread",
          datasetId: "dogfood-renewal",
          nodeSetIds: ["customer-success"],
          onlyContext: true,
        },
        provenanceKinds: {
          source_artifact: 1,
          vault_projection: 1,
        },
      },
    });
    expect(result.hits[0]).toMatchObject({
      id: "brain:page-acme",
      providerId: "brain",
      family: "brain",
      sourceFamily: "brain",
      provenance: {
        metadata: {
          retrievalKind: "graph",
          instructionBoundary: "untrusted_source_data",
          artifactManifests: [
            expect.objectContaining({
              kind: "source_artifact",
              retrievalKind: "source_artifact",
              sourceIdHash: "hash-abc",
            }),
            expect.objectContaining({
              kind: "vault_projection",
              retrievalKind: "vault_projection",
              sourceIdHash: "hash-vault",
            }),
          ],
        },
      },
      metadata: {
        sourceDataPolicy: {
          forbiddenUse: "do_not_execute_or_expand_tool_policy",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("source-artifacts/");
    expect(JSON.stringify(result)).not.toContain("s3://");
  });

  it("reports explicit provider status when retrieval is disabled", async () => {
    const searchPages = vi.fn(async () => []);
    const provider = createCompanyBrainContextProvider({
      loadSubstrateState: async () => ({
        ...readySubstrate,
        launch_capabilities: {
          retrieval: { status: "disabled", message: "dogfood disabled" },
          provenance: { status: "enabled" },
        },
      }),
      searchPages,
      loadArtifactManifests: async () => [],
    });

    const result = await provider.query(request);

    expect(result.hits).toEqual([]);
    expect(result.status).toMatchObject({
      state: "skipped",
      reason: "Company Brain capability disabled: retrieval",
      metadata: {
        capabilities: {
          retrieval: "disabled",
          provenance: "enabled",
        },
      },
    });
    expect(searchPages).not.toHaveBeenCalled();
  });

  it("reports missing substrate instead of falling back to other providers", async () => {
    const searchPages = vi.fn(async () => []);
    const provider = createCompanyBrainContextProvider({
      loadSubstrateState: async () => null,
      searchPages,
      loadArtifactManifests: async () => [],
    });

    const result = await provider.query(request);

    expect(result).toEqual({
      hits: [],
      status: {
        state: "skipped",
        reason: "Company Brain substrate is not installed for this tenant",
        metadata: { activeBackend: "none", storageTier: null },
      },
    });
    expect(searchPages).not.toHaveBeenCalled();
  });
});

describe("Company Brain search query helpers", () => {
  it("normalizes semantic search terms and ignores punctuation-only queries", () => {
    expect(normalizeBrainSearchTerms("What is the Acme renewal risk?")).toEqual(
      ["acme", "renewal", "risk"],
    );
    expect(buildBrainPrefixTsQuery("What is the Acme renewal risk?")).toBe(
      "acme:* & renewal:* & risk:*",
    );
    expect(buildBrainPrefixTsQuery("% _ --")).toBeNull();
  });

  it("escapes SQL LIKE wildcard characters in user queries", () => {
    expect(brainLikePattern("100% renewal_risk \\ urgent")).toBe(
      "%100\\% renewal\\_risk \\\\ urgent%",
    );
  });
});
