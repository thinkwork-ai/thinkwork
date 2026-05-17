import { describe, expect, it, vi } from "vitest";
import { createBrainContextProvider, type BrainContextRow } from "./brain.js";

describe("ontology Brain context provider", () => {
  it("returns ontology-shaped facet hits with provenance and trust metadata", async () => {
    const provider = createBrainContextProvider({
      search: async (args) => {
        expect(args).toMatchObject({
          tenantId: "tenant-1",
          query: "Acme meeting prep commitments risks",
          limit: 5,
        });
        return [
          {
            pageId: "page-acme",
            pageTitle: "Acme",
            pageSlug: "acme",
            pageSummary: "Strategic customer.",
            pageBodyMd: null,
            entitySubtype: "customer",
            sectionId: "section-commitments",
            sectionSlug: "open_commitments",
            sectionHeading: "Open Commitments",
            sectionBodyMd:
              "- Nora owns renewal pricing by 2026-05-20. [support:case-1]",
            sectionPosition: 40,
            facetType: "activity",
            sourceFacetType: "operational",
            entityTypeId: "entity-customer",
            entityTypeSlug: "customer",
            entityTypeName: "Customer",
            entityTypeDescription: "A customer or account.",
            entityTemplateSource: "tenant",
            facetTemplateId: "facet-commitments",
            facetTemplateSource: "tenant",
            ontologyVersionId: "ontology-version-3",
            ontologyVersionNumber: 3,
            sourceReferences: [
              {
                kind: "support_case",
                ref: "case-1",
                asOf: "2026-05-17T12:00:00.000Z",
                ttlSeconds: 86_400,
              },
            ],
            relationshipReferences: [
              {
                kind: "owns_relationship",
                label: "Owns relationship",
                targetTitle: "Nora Mills",
              },
            ],
            freshnessAsOf: "2026-05-17T12:00:00.000Z",
            ttlSeconds: 86_400,
            score: 0.92,
          },
        ];
      },
    });

    const result = await provider.query({
      query: "Acme meeting prep commitments risks",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 5,
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(result.status).toMatchObject({
      metadata: { ontologyAware: true, degraded: false },
    });
    expect(result.hits[0]).toMatchObject({
      id: "brain:page-acme:facet:section-commitments",
      providerId: "brain",
      family: "brain",
      sourceFamily: "brain",
      title: "Acme - Open Commitments",
      provenance: {
        uri: "thinkwork://brain/customer/acme#open_commitments",
        metadata: {
          entityType: "customer",
          relationshipLabels: ["Owns relationship"],
          facetSlug: "open_commitments",
          facetType: "activity",
          sourceTrustTier: "operational",
          ontologyVersionId: "ontology-version-3",
          sourceReferences: [
            expect.objectContaining({
              kind: "support_case",
              ref: "case-1",
            }),
          ],
        },
      },
      metadata: {
        ontology: {
          entityType: {
            slug: "customer",
            label: "Customer",
            templateSource: "tenant",
          },
          facet: {
            slug: "open_commitments",
            heading: "Open Commitments",
            type: "activity",
            sourceTrustTier: "operational",
            templateSource: "tenant",
            trustRank: 5,
          },
          version: {
            id: "ontology-version-3",
            versionNumber: 3,
          },
          relationships: [
            expect.objectContaining({
              label: "Owns relationship",
              targetTitle: "Nora Mills",
            }),
          ],
        },
      },
      freshness: {
        asOf: "2026-05-17T12:00:00.000Z",
        ttlSeconds: 86_400,
      },
    });
  });

  it("returns meeting-prep commitments and risks as structured facets", async () => {
    const provider = createBrainContextProvider({
      search: async () => [
        brainRow({
          sectionId: "commitments",
          sectionSlug: "open_commitments",
          sectionHeading: "Open Commitments",
          sectionBodyMd: "- Send updated DPA before Tuesday.",
          facetType: "activity",
          sourceFacetType: "activity",
        }),
        brainRow({
          sectionId: "risks",
          sectionSlug: "risks_and_landmines",
          sectionHeading: "Risks & Landmines",
          sectionBodyMd: "- Support escalation is blocking expansion.",
          facetType: "compiled",
          sourceFacetType: "operational",
        }),
      ],
    });

    const result = await provider.query({
      query: "Acme meeting prep",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 10,
      caller: { tenantId: "tenant-1", userId: "user-1" },
    });

    expect(
      result.hits
        .map((hit) => hit.metadata?.ontology)
        .map((ontology: any) => ({
          slug: ontology.facet.slug,
          type: ontology.facet.type,
        })),
    ).toEqual([
      { slug: "open_commitments", type: "activity" },
      { slug: "risks_and_landmines", type: "compiled" },
    ]);
    expect(result.hits[0]?.provenance.metadata?.sourceReferences).toEqual([
      expect.objectContaining({ kind: "support_case", ref: "case-1" }),
    ]);
  });

  it("skips direct provider calls without tenant scope", async () => {
    const search = vi.fn();
    const provider = createBrainContextProvider({ search });

    const result = await provider.query({
      query: "Acme",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 5,
      caller: { tenantId: "" },
    });

    expect(search).not.toHaveBeenCalled();
    expect(result).toEqual({
      hits: [],
      status: {
        state: "skipped",
        reason: "tenant scope is required for ontology Brain search",
      },
    });
  });

  it("degrades to page hits when ontology metadata lookup fails", async () => {
    const provider = createBrainContextProvider({
      search: async () => {
        throw new Error("ontology relation unavailable");
      },
      fallbackSearch: async () => [
        {
          pageId: "page-acme",
          pageTitle: "Acme",
          pageSlug: "acme",
          pageSummary: "Strategic customer.",
          pageBodyMd: null,
          entitySubtype: "customer",
          score: 0.4,
        },
      ],
    });

    const result = await provider.query({
      query: "Acme",
      mode: "results",
      scope: "auto",
      depth: "quick",
      limit: 5,
      caller: { tenantId: "tenant-1" },
    });

    expect(result.status).toMatchObject({
      state: "stale",
      reason: "ontology metadata lookup failed: ontology relation unavailable",
      metadata: { ontologyAware: false, degraded: true },
    });
    expect(result.hits[0]).toMatchObject({
      id: "brain:page-acme",
      sourceFamily: "brain",
      metadata: { ontology: null, degraded: true },
    });
  });
});

function brainRow(overrides: Partial<BrainContextRow> = {}): BrainContextRow {
  return {
    pageId: "page-acme",
    pageTitle: "Acme",
    pageSlug: "acme",
    pageSummary: "Strategic customer.",
    pageBodyMd: null,
    entitySubtype: "customer",
    sectionId: "section-1",
    sectionSlug: "overview",
    sectionHeading: "Overview",
    sectionBodyMd: "Acme is a strategic customer.",
    sectionPosition: 10,
    facetType: "compiled",
    sourceFacetType: "compiled",
    entityTypeId: "entity-customer",
    entityTypeSlug: "customer",
    entityTypeName: "Customer",
    entityTypeDescription: "A customer or account.",
    entityTemplateSource: "tenant" as const,
    facetTemplateId: "facet-1",
    facetTemplateSource: "tenant" as const,
    ontologyVersionId: "ontology-version-3",
    ontologyVersionNumber: 3,
    sourceReferences: [{ kind: "support_case", ref: "case-1" }],
    relationshipReferences: [],
    freshnessAsOf: null,
    ttlSeconds: null,
    score: 0.8,
    ...overrides,
  };
}
