import { describe, expect, it } from "vitest";
import type { OntologyCompileSnapshot } from "./compile-snapshot.js";
import { applyOntologyMaterializationGate } from "./materialization-gate.js";
import type { PlannerResult } from "../wiki/planner.js";

describe("applyOntologyMaterializationGate", () => {
  it("allows approved entity pages, facets, and relationships", () => {
    const plan = planWith({
      newPages: [
        {
          type: "entity",
          entityTypeSlug: "customer",
          slug: "acme",
          title: "Acme",
          source_refs: ["r1"],
          sections: [
            {
              slug: "overview",
              facetSlug: "overview",
              heading: "Overview",
              body_md: "Acme is active.",
              source_refs: ["r1"],
            },
          ],
        },
        {
          type: "entity",
          entityTypeSlug: "person",
          slug: "ada",
          title: "Ada",
          source_refs: ["r2"],
          sections: [
            {
              slug: "overview",
              facetSlug: "overview",
              heading: "Overview",
              body_md: "Ada is the sponsor.",
              source_refs: ["r2"],
            },
          ],
        },
      ],
      pageLinks: [
        {
          fromType: "entity",
          fromSlug: "acme",
          toType: "entity",
          toSlug: "ada",
          relationshipTypeSlug: "has_stakeholder",
          context: "Ada sponsors Acme.",
        },
      ],
    });

    const result = applyOntologyMaterializationGate({
      plan,
      snapshot: ontologySnapshot(),
    });

    expect(result.plan.newPages).toHaveLength(2);
    expect(result.plan.pageLinks).toHaveLength(1);
    expect(result.metrics.ontology_gate_approved_pages).toBe(2);
    expect(result.metrics.ontology_gate_approved_facets).toBe(2);
    expect(result.metrics.ontology_gate_approved_relationships).toBe(1);
    expect(result.metrics.ontology_gate_rejected_pages).toBe(0);
  });

  it("reroutes unapproved entity pages into unresolved evidence", () => {
    const plan = planWith({
      newPages: [
        {
          type: "entity",
          entityTypeSlug: "vendor",
          slug: "sprocket-inc",
          title: "Sprocket Inc",
          source_refs: ["r1"],
          sections: [
            {
              slug: "overview",
              facetSlug: "overview",
              heading: "Overview",
              body_md: "Potential vendor.",
              source_refs: ["r1"],
            },
          ],
        },
      ],
    });

    const result = applyOntologyMaterializationGate({
      plan,
      snapshot: ontologySnapshot(),
    });

    expect(result.plan.newPages).toEqual([]);
    expect(result.plan.unresolvedMentions).toMatchObject([
      {
        alias: "Sprocket Inc",
        suggestedType: "entity",
        entityTypeSlug: "vendor",
        source_ref: "r1",
      },
    ]);
    expect(result.metrics.ontology_gate_rejected_pages).toBe(1);
    expect(result.metrics.ontology_gate_unresolved_observations).toBe(1);
    expect(result.metrics.ontology_gate_suggestion_candidates).toBe(1);
  });

  it("drops unapproved facets before section writes", () => {
    const plan = planWith({
      newPages: [
        {
          type: "entity",
          entityTypeSlug: "customer",
          slug: "acme",
          title: "Acme",
          source_refs: ["r1"],
          sections: [
            {
              slug: "overview",
              facetSlug: "overview",
              heading: "Overview",
              body_md: "Approved.",
              source_refs: ["r1"],
            },
            {
              slug: "secrets",
              facetSlug: "secrets",
              heading: "Secrets",
              body_md: "Not approved.",
              source_refs: ["r1"],
            },
          ],
        },
      ],
    });

    const result = applyOntologyMaterializationGate({
      plan,
      snapshot: ontologySnapshot(),
    });

    expect(
      result.plan.newPages[0]?.sections.map((section) => section.slug),
    ).toEqual(["overview"]);
    expect(result.metrics.ontology_gate_approved_facets).toBe(1);
    expect(result.metrics.ontology_gate_rejected_facets).toBe(1);
  });

  it("rejects relationships whose endpoints do not match the approved type constraints", () => {
    const plan = planWith({
      newPages: [
        {
          type: "entity",
          entityTypeSlug: "customer",
          slug: "acme",
          title: "Acme",
          source_refs: ["r1"],
          sections: [
            {
              slug: "overview",
              facetSlug: "overview",
              heading: "Overview",
              body_md: "Acme is active.",
              source_refs: ["r1"],
            },
          ],
        },
        {
          type: "entity",
          entityTypeSlug: "customer",
          slug: "globex",
          title: "Globex",
          source_refs: ["r2"],
          sections: [
            {
              slug: "overview",
              facetSlug: "overview",
              heading: "Overview",
              body_md: "Globex is active.",
              source_refs: ["r2"],
            },
          ],
        },
      ],
      pageLinks: [
        {
          fromType: "entity",
          fromSlug: "acme",
          toType: "entity",
          toSlug: "globex",
          relationshipTypeSlug: "has_stakeholder",
        },
      ],
    });

    const result = applyOntologyMaterializationGate({
      plan,
      snapshot: ontologySnapshot(),
    });

    expect(result.plan.pageLinks).toEqual([]);
    expect(result.metrics.ontology_gate_rejected_relationships).toBe(1);
    expect(result.plan.unresolvedMentions[0]?.alias).toBe("acme -> globex");
  });

  it("fails loudly for malformed active snapshots", () => {
    const snapshot = ontologySnapshot();
    snapshot.facetTemplatesByKey.set("ghost:overview", {
      key: "ghost:overview",
      entityTypeSlug: "ghost",
      slug: "overview",
      heading: "Overview",
      facetType: "compiled",
      position: 1,
      sourcePriority: ["hindsight_memory_unit"],
      prompt: null,
      guidanceNotes: null,
      source: "tenant",
    });

    expect(() =>
      applyOntologyMaterializationGate({
        plan: planWith({}),
        snapshot,
      }),
    ).toThrow(/references unknown entity type ghost/);
  });
});

function planWith(overrides: Partial<PlannerResult>): PlannerResult {
  return {
    pageUpdates: [],
    newPages: [],
    unresolvedMentions: [],
    promotions: [],
    pageLinks: [],
    parentSectionUpdates: [],
    sectionPromotions: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    ...overrides,
  };
}

function ontologySnapshot(): OntologyCompileSnapshot {
  return {
    tenantId: "t1",
    activeVersionId: "version-1",
    activeVersionNumber: 1,
    conservative: false,
    entityTypeSlugs: new Set(["customer", "person"]),
    relationshipTypeSlugs: new Set(["has_stakeholder"]),
    facetTemplateKeys: new Set(["customer:overview", "person:overview"]),
    externalMappingKeys: new Set(),
    entityTypesBySlug: new Map([
      [
        "customer",
        {
          id: "entity-customer",
          slug: "customer",
          name: "Customer",
          broadType: "organization",
          description: null,
          aliases: [],
          guidanceNotes: null,
          externalMappings: [],
        },
      ],
      [
        "person",
        {
          id: "entity-person",
          slug: "person",
          name: "Person",
          broadType: "person",
          description: null,
          aliases: [],
          guidanceNotes: null,
          externalMappings: [],
        },
      ],
    ]),
    relationshipTypesBySlug: new Map([
      [
        "has_stakeholder",
        {
          id: "relationship-stakeholder",
          slug: "has_stakeholder",
          name: "Has stakeholder",
          description: null,
          inverseName: "Stakeholder of",
          sourceTypeSlugs: ["customer"],
          targetTypeSlugs: ["person"],
          aliases: [],
          guidanceNotes: null,
          externalMappings: [],
        },
      ],
    ]),
    facetTemplatesByKey: new Map([
      [
        "customer:overview",
        {
          key: "customer:overview",
          entityTypeSlug: "customer",
          slug: "overview",
          heading: "Overview",
          facetType: "compiled",
          position: 1,
          sourcePriority: ["hindsight_memory_unit"],
          prompt: null,
          guidanceNotes: null,
          source: "tenant",
        },
      ],
      [
        "person:overview",
        {
          key: "person:overview",
          entityTypeSlug: "person",
          slug: "overview",
          heading: "Overview",
          facetType: "compiled",
          position: 1,
          sourcePriority: ["hindsight_memory_unit"],
          prompt: null,
          guidanceNotes: null,
          source: "tenant",
        },
      ],
    ]),
    templatesByEntityType: {},
  };
}
