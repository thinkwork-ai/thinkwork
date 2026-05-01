import { describe, expect, it } from "vitest";

import { synthesizeBrainEnrichmentCandidates } from "./enrichment-candidate-synthesis.js";
import type { ContextHit } from "../context-engine/types.js";

describe("Brain enrichment candidate synthesis", () => {
  it("turns Web hits into cited page-update candidates", () => {
    const candidates = synthesizeBrainEnrichmentCandidates({
      hits: [
        {
          id: "web:1",
          providerId: "builtin:web-search",
          family: "mcp",
          sourceFamily: "web",
          title: "Thinkwork launches new pricing",
          snippet:
            "Thinkwork published new pricing details for enterprise plans.",
          score: 0.8,
          scope: "auto",
          provenance: {
            label: "Web Search",
            uri: "https://example.com/pricing",
            sourceId: "web-1",
          },
        },
      ],
      sourceFamilies: ["WEB"],
      limit: 10,
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        title: "Thinkwork launches new pricing",
        summary:
          "External source reports: Thinkwork published new pricing details for enterprise plans.",
        sourceFamily: "WEB",
        providerId: "builtin:web-search",
        citation: expect.objectContaining({
          label: "Web Search",
          uri: "https://example.com/pricing",
          sourceId: "web-1",
        }),
      }),
    ]);
  });

  it("keeps Brain hits deterministic without Web selected", () => {
    const hits: ContextHit[] = [
      {
        id: "memory:1",
        providerId: "memory",
        family: "memory",
        sourceFamily: "brain",
        title: "Customer asks for SOC2",
        snippet: "Acme needs SOC2 details before procurement.",
        scope: "auto",
        provenance: { label: "Brain" },
      },
      {
        id: "web:1",
        providerId: "builtin:web-search",
        family: "mcp",
        sourceFamily: "web",
        title: "Acme press release",
        snippet: "Not requested.",
        scope: "auto",
        provenance: { label: "Web Search" },
      },
    ];

    expect(
      synthesizeBrainEnrichmentCandidates({
        hits,
        sourceFamilies: ["BRAIN"],
        limit: 10,
      }),
    ).toEqual([
      expect.objectContaining({
        title: "Customer asks for SOC2",
        summary: "Acme needs SOC2 details before procurement.",
        sourceFamily: "BRAIN",
      }),
    ]);
  });

  it("dedupes mixed-source candidates while preferring Brain over Web", () => {
    const candidates = synthesizeBrainEnrichmentCandidates({
      hits: [
        {
          id: "web:1",
          providerId: "builtin:web-search",
          family: "mcp",
          sourceFamily: "web",
          title: "Acme opened Austin office",
          snippet: "Acme opened an Austin office in April.",
          scope: "auto",
          provenance: {
            label: "Web Search",
            uri: "https://example.com/acme-austin",
          },
        },
        {
          id: "brain:1",
          providerId: "memory",
          family: "memory",
          sourceFamily: "brain",
          title: "Acme opened Austin office",
          snippet: "Acme opened an Austin office in April.",
          scope: "auto",
          provenance: { label: "Brain", sourceId: "memory-1" },
        },
      ],
      sourceFamilies: ["BRAIN", "WEB"],
      limit: 10,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sourceFamily: "BRAIN",
      providerId: "memory",
      citation: {
        label: "Brain",
        uri: "https://example.com/acme-austin",
        sourceId: "memory-1",
      },
    });
  });
});
