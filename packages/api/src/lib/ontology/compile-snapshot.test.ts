import { describe, expect, it } from "vitest";
import {
  buildOntologyCompileSnapshot,
  facetTemplateKey,
  relationshipAllowsEndpoints,
} from "./compile-snapshot.js";
import { SEED_ONTOLOGY_TEMPLATES } from "./templates.js";

describe("ontology compile snapshot", () => {
  it("stays conservative when there is no active ontology version", () => {
    const snapshot = buildOntologyCompileSnapshot({
      definitions: {
        tenantId: "tenant-1",
        activeVersion: null,
        entityTypes: [
          entityType({
            id: "entity-customer",
            slug: "customer",
          }),
        ],
        relationshipTypes: [],
        facetTemplates: [],
        externalMappings: [],
      },
      templates: SEED_ONTOLOGY_TEMPLATES,
    });

    expect(snapshot.conservative).toBe(true);
    expect(snapshot.entityTypeSlugs.size).toBe(0);
    expect(snapshot.facetTemplateKeys.size).toBe(0);
    expect(snapshot.relationshipTypeSlugs.size).toBe(0);
  });

  it("normalizes only approved ontology definitions into write-allowing sets", () => {
    const snapshot = buildOntologyCompileSnapshot({
      definitions: {
        tenantId: "tenant-1",
        activeVersion: {
          id: "version-1",
          tenantId: "tenant-1",
          versionNumber: 1,
          status: "active",
          sourceChangeSetId: null,
          activatedAt: null,
          createdAt: null,
        },
        entityTypes: [
          entityType({
            id: "entity-customer",
            slug: "customer",
            externalMappings: [
              {
                id: "mapping-customer",
                subjectKind: "entity_type",
                subjectId: "entity-customer",
                mappingKind: "BROAD",
                vocabulary: "schema.org",
                externalUri: "https://schema.org/Organization",
              },
            ],
          }),
          entityType({
            id: "entity-proposed",
            slug: "support_case",
            lifecycleStatus: "PROPOSED",
          }),
        ],
        relationshipTypes: [
          relationshipType({
            id: "rel-stakeholder",
            slug: "has_stakeholder",
            sourceTypeSlugs: ["customer"],
            targetTypeSlugs: ["person"],
          }),
          relationshipType({
            id: "rel-proposed",
            slug: "has_support_case",
            lifecycleStatus: "PROPOSED",
            sourceTypeSlugs: ["customer"],
            targetTypeSlugs: ["support_case"],
          }),
          relationshipType({
            id: "rel-unknown-target",
            slug: "has_unknown",
            sourceTypeSlugs: ["customer"],
            targetTypeSlugs: ["unknown_type"],
          }),
        ],
        facetTemplates: [],
        externalMappings: [
          {
            id: "mapping-customer",
            tenantId: "tenant-1",
            subjectKind: "entity_type",
            subjectId: "entity-customer",
            mappingKind: "BROAD",
            vocabulary: "schema.org",
            externalUri: "https://schema.org/Organization",
            externalLabel: "Organization",
            notes: null,
            createdAt: null,
            updatedAt: null,
          },
        ],
      },
      templates: {
        customer: SEED_ONTOLOGY_TEMPLATES.customer,
        person: SEED_ONTOLOGY_TEMPLATES.person,
        support_case: SEED_ONTOLOGY_TEMPLATES.support_case,
      },
    });

    expect(snapshot.conservative).toBe(false);
    expect(snapshot.activeVersionId).toBe("version-1");
    expect([...snapshot.entityTypeSlugs]).toEqual(["customer"]);
    expect(snapshot.entityTypesBySlug.get("customer")).toMatchObject({
      slug: "customer",
      externalMappings: [
        expect.objectContaining({
          vocabulary: "schema.org",
          externalUri: "https://schema.org/Organization",
        }),
      ],
    });
    expect(snapshot.entityTypesBySlug.has("support_case")).toBe(false);
    expect(snapshot.facetTemplateKeys.has("customer:overview")).toBe(true);
    expect(snapshot.facetTemplateKeys.has("support_case:overview")).toBe(false);
    expect(snapshot.relationshipTypeSlugs.size).toBe(0);
    expect(
      snapshot.externalMappingKeys.has(
        "entity_type:entity-customer:schema.org:https://schema.org/Organization",
      ),
    ).toBe(true);
  });

  it("keeps approved relationships when endpoint constraints target approved types", () => {
    const snapshot = buildOntologyCompileSnapshot({
      definitions: {
        tenantId: "tenant-1",
        activeVersion: {
          id: "version-1",
          tenantId: "tenant-1",
          versionNumber: 1,
          status: "active",
          sourceChangeSetId: null,
          activatedAt: null,
          createdAt: null,
        },
        entityTypes: [
          entityType({ id: "entity-customer", slug: "customer" }),
          entityType({ id: "entity-person", slug: "person" }),
        ],
        relationshipTypes: [
          relationshipType({
            id: "rel-stakeholder",
            slug: "has_stakeholder",
            sourceTypeSlugs: ["customer"],
            targetTypeSlugs: ["person"],
          }),
        ],
        facetTemplates: [],
        externalMappings: [],
      },
      templates: SEED_ONTOLOGY_TEMPLATES,
    });

    const relationship =
      snapshot.relationshipTypesBySlug.get("has_stakeholder");

    expect(snapshot.relationshipTypeSlugs.has("has_stakeholder")).toBe(true);
    expect(relationship).toBeTruthy();
    expect(
      relationshipAllowsEndpoints(relationship!, {
        sourceTypeSlug: "customer",
        targetTypeSlug: "person",
      }),
    ).toBe(true);
    expect(
      relationshipAllowsEndpoints(relationship!, {
        sourceTypeSlug: "person",
        targetTypeSlug: "customer",
      }),
    ).toBe(false);
  });

  it("exposes stable facet keys for later materialization gates", () => {
    expect(
      facetTemplateKey({
        entityTypeSlug: "customer",
        facetSlug: "commitments",
      }),
    ).toBe("customer:commitments");
  });
});

function entityType(overrides: Record<string, unknown> = {}) {
  return {
    id: "entity-1",
    tenantId: "tenant-1",
    versionId: "version-1",
    slug: "customer",
    name: "Customer",
    description: null,
    broadType: "organization",
    aliases: [],
    propertiesSchema: {},
    guidanceNotes: null,
    lifecycleStatus: "APPROVED",
    approvedAt: null,
    deprecatedAt: null,
    rejectedAt: null,
    createdAt: null,
    updatedAt: null,
    facetTemplates: [],
    externalMappings: [],
    ...overrides,
  };
}

function relationshipType(overrides: Record<string, unknown> = {}) {
  return {
    id: "rel-1",
    tenantId: "tenant-1",
    versionId: "version-1",
    slug: "has_stakeholder",
    name: "Has stakeholder",
    description: null,
    inverseName: "Stakeholder of",
    sourceEntityTypeId: null,
    targetEntityTypeId: null,
    sourceTypeSlugs: ["customer"],
    targetTypeSlugs: ["person"],
    aliases: [],
    guidanceNotes: null,
    lifecycleStatus: "APPROVED",
    approvedAt: null,
    deprecatedAt: null,
    rejectedAt: null,
    createdAt: null,
    updatedAt: null,
    externalMappings: [],
    ...overrides,
  };
}
