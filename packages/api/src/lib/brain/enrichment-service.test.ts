import { describe, expect, it } from "vitest";
import {
  buildEnrichmentCandidates,
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
});
