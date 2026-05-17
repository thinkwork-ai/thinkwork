import { describe, expect, it } from "vitest";
import {
  buildMaterializedSectionDraft,
  composeMaterializedBody,
  shouldPreserveExistingSection,
  type MaterializerExternalRef,
  type MaterializerPage,
  type MaterializerSection,
} from "./materializer.js";
import type { OntologyFacetSectionTemplate } from "./templates.js";

const customerPage: MaterializerPage = {
  id: "page-1",
  tenant_id: "tenant-1",
  entity_subtype: "customer",
  title: "Acme",
  summary: "Strategic customer.",
  body_md: null,
};

function template(
  overrides: Partial<OntologyFacetSectionTemplate> = {},
): OntologyFacetSectionTemplate {
  return {
    slug: "open_commitments",
    heading: "Open Commitments",
    facetType: "activity",
    position: 20,
    sourcePriority: ["support_case", "hindsight_memory_unit"],
    prompt: null,
    guidanceNotes: null,
    lifecycleStatus: "approved",
    source: "tenant",
    ...overrides,
  };
}

function existingSection(
  overrides: Partial<MaterializerSection> = {},
): MaterializerSection {
  return {
    id: "section-1",
    section_slug: "open_commitments",
    heading: "Open Commitments",
    body_md: "Existing sourced commitment.",
    position: 20,
    aggregation: {
      facet_type: "activity",
      source_facet_type: "activity",
    },
    status: "active",
    ...overrides,
  };
}

describe("ontology materializer", () => {
  it("rejects source-less section drafts rather than writing trusted Brain content", () => {
    const draft = buildMaterializedSectionDraft({
      page: customerPage,
      template: template(),
      existingSection: null,
      existingSources: [],
      externalRefs: [],
    });

    expect(draft).toBeNull();
  });

  it("builds predictable commitment facets from matching external refs", () => {
    const refs: MaterializerExternalRef[] = [
      {
        id: "ref-1",
        source_kind: "support_case",
        external_id: "case-1",
        source_payload: {
          customerSlug: "acme",
          title: "Send renewal pricing",
          dueDate: "2026-05-20",
          owner: "Nora",
          status: "open",
        },
      },
    ];

    const draft = buildMaterializedSectionDraft({
      page: customerPage,
      template: template(),
      existingSection: null,
      existingSources: [],
      externalRefs: refs,
    });

    expect(draft?.content).toContain("Send renewal pricing");
    expect(draft?.content).toContain("due: 2026-05-20");
    expect(draft?.sources).toEqual([
      expect.objectContaining({ kind: "support_case", ref: "case-1" }),
    ]);
  });

  it("preserves higher-trust existing content when incoming evidence is lower trust", () => {
    expect(
      shouldPreserveExistingSection(
        existingSection({
          aggregation: {
            facet_type: "operational",
            source_facet_type: "operational",
          },
        }),
        [{ kind: "web_url", ref: "https://example.com" }],
      ),
    ).toBe(true);
  });

  it("composes page body from ordered materialized sections", () => {
    expect(
      composeMaterializedBody([
        { heading: "Risks", body_md: "Risk body.", position: 30 },
        { heading: "Overview", body_md: "Overview body.", position: 10 },
      ]),
    ).toBe("## Overview\n\nOverview body.\n\n## Risks\n\nRisk body.");
  });
});
