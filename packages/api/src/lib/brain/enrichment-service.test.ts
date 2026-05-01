import { describe, expect, it } from "vitest";
import {
  buildEnrichmentCandidates,
  listBrainEnrichmentSources,
  selectProviderIdsForSourceFamilies,
} from "./enrichment-service.js";
import { isBrainEnrichmentReviewPayload } from "./enrichment-apply.js";
import type {
  ContextHit,
  ContextProviderDescriptor,
} from "../context-engine/types.js";

function provider(
  overrides: Partial<ContextProviderDescriptor> & {
    id: string;
    family: ContextProviderDescriptor["family"];
  },
): ContextProviderDescriptor {
  return {
    displayName: overrides.id,
    defaultEnabled: true,
    query: async () => ({ hits: [] }),
    ...overrides,
  };
}

describe("Brain enrichment service", () => {
  it("selects provider ids for Brain, Web, and Knowledge Base source families", () => {
    const ids = selectProviderIdsForSourceFamilies(
      [
        provider({ id: "memory", family: "memory" }),
        provider({ id: "wiki", family: "wiki" }),
        provider({ id: "kb", family: "knowledge-base" }),
        provider({
          id: "web-search",
          family: "mcp",
          displayName: "Web Search",
        }),
        provider({ id: "crm", family: "sub-agent", displayName: "CRM" }),
      ],
      ["BRAIN", "WEB", "KNOWLEDGE_BASE"],
    );

    expect(ids).toEqual(["memory", "wiki", "kb", "web-search"]);
  });

  it("builds cited candidates only for requested source families", () => {
    const hits: ContextHit[] = [
      {
        id: "wiki:1",
        providerId: "wiki",
        family: "wiki",
        sourceFamily: "pages",
        title: "Customer X",
        snippet: "Customer X wants a pricing review.",
        score: 0.9,
        scope: "auto",
        provenance: {
          label: "Company Brain Pages",
          uri: "thinkwork://wiki/topic/customer-x",
          sourceId: "page-1",
          metadata: { slug: "customer-x" },
        },
      },
      {
        id: "workspace:1",
        providerId: "workspace",
        family: "workspace",
        sourceFamily: "workspace",
        title: "Workspace note",
        snippet: "Not requested.",
        scope: "auto",
        provenance: {},
      },
    ];

    const candidates = buildEnrichmentCandidates({
      hits,
      sourceFamilies: ["BRAIN"],
      limit: 10,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      title: "Customer X",
      summary: "Customer X wants a pricing review.",
      sourceFamily: "BRAIN",
      providerId: "wiki",
      citation: {
        label: "Company Brain Pages",
        uri: "thinkwork://wiki/topic/customer-x",
        sourceId: "page-1",
        metadata: { slug: "customer-x" },
      },
    });
  });

  it("recognizes Brain enrichment review payloads after JSON serialization", () => {
    expect(
      isBrainEnrichmentReviewPayload(
        JSON.stringify({
          kind: "brain_enrichment_review",
          candidates: [],
        }),
      ),
    ).toBe(true);
  });

  it("lists only available source families with Web unselected by default", async () => {
    const sources = await listBrainEnrichmentSources({
      tenantId: "tenant-1",
      caller: { tenantId: "tenant-1", userId: "user-1" },
      contextEngine: {
        listProviders: async () => [
          provider({ id: "memory", family: "memory" }),
          provider({ id: "kb", family: "knowledge-base" }),
          provider({
            id: "builtin:web-search",
            family: "mcp",
            sourceFamily: "web",
            defaultEnabled: false,
            displayName: "Web Search",
          }),
        ],
        query: async () => {
          throw new Error("not used");
        },
      },
    });

    expect(sources).toEqual([
      {
        family: "BRAIN",
        label: "Brain",
        available: true,
        selectedByDefault: true,
        reason: null,
      },
      {
        family: "KNOWLEDGE_BASE",
        label: "Knowledge Base",
        available: true,
        selectedByDefault: true,
        reason: null,
      },
      {
        family: "WEB",
        label: "Web",
        available: true,
        selectedByDefault: false,
        reason: null,
      },
    ]);
  });

  it("omits Web from source availability when no Web provider is registered", async () => {
    const sources = await listBrainEnrichmentSources({
      tenantId: "tenant-1",
      caller: { tenantId: "tenant-1", userId: "user-1" },
      contextEngine: {
        listProviders: async () => [
          provider({ id: "memory", family: "memory" }),
          provider({ id: "kb", family: "knowledge-base" }),
        ],
        query: async () => {
          throw new Error("not used");
        },
      },
    });

    expect(sources.map((source) => source.family)).toEqual([
      "BRAIN",
      "KNOWLEDGE_BASE",
    ]);
  });
});
