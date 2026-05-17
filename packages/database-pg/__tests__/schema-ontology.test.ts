import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  ONTOLOGY_CHANGE_SET_STATUSES,
  ONTOLOGY_JOB_STATUSES,
  ONTOLOGY_LIFECYCLE_STATUSES,
  ONTOLOGY_MAPPING_KINDS,
  ontologyChangeSetItems,
  ontologyChangeSets,
  ontologyEntityTypes,
  ontologyEvidenceExamples,
  ontologyExternalMappings,
  ontologyFacetTemplates,
  ontologyReprocessJobs,
  ontologyRelationshipTypes,
  ontologySuggestionScanJobs,
  ontologyVersions,
} from "../src/schema/ontology";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0098 = readFileSync(
  join(HERE, "..", "drizzle", "0098_business_ontology.sql"),
  "utf-8",
);

describe("business ontology schema", () => {
  it("defines tenant-scoped ontology versions and approved entity types", () => {
    expect(getTableName(ontologyVersions)).toBe("versions");
    expect(getTableName(ontologyEntityTypes)).toBe("entity_types");

    const versionColumns = getTableColumns(ontologyVersions);
    expect(versionColumns.tenant_id.notNull).toBe(true);
    expect(versionColumns.version_number.notNull).toBe(true);
    expect(versionColumns.status.default).toBe("active");

    const entityColumns = getTableColumns(ontologyEntityTypes);
    expect(entityColumns.tenant_id.notNull).toBe(true);
    expect(entityColumns.slug.notNull).toBe(true);
    expect(entityColumns.lifecycle_status.default).toBe("proposed");
    expect(entityColumns.broad_type.default).toBe("entity");

    expect(ONTOLOGY_LIFECYCLE_STATUSES).toEqual([
      "proposed",
      "approved",
      "deprecated",
      "rejected",
    ]);
  });

  it("models relationship types, facet templates, and external mappings", () => {
    expect(getTableName(ontologyRelationshipTypes)).toBe("relationship_types");
    expect(getTableName(ontologyFacetTemplates)).toBe("facet_templates");
    expect(getTableName(ontologyExternalMappings)).toBe("external_mappings");

    expect(
      getTableColumns(ontologyRelationshipTypes).source_type_slugs.notNull,
    ).toBe(true);
    expect(
      getTableColumns(ontologyRelationshipTypes).target_type_slugs.notNull,
    ).toBe(true);
    expect(getTableColumns(ontologyFacetTemplates).entity_type_id.notNull).toBe(
      true,
    );
    expect(getTableColumns(ontologyExternalMappings).mapping_kind.notNull).toBe(
      true,
    );

    expect(ONTOLOGY_MAPPING_KINDS).toContain("broad");
  });

  it("captures suggested ontology evolution as change sets with line items and evidence", () => {
    expect(getTableName(ontologyChangeSets)).toBe("change_sets");
    expect(getTableName(ontologyChangeSetItems)).toBe("change_set_items");
    expect(getTableName(ontologyEvidenceExamples)).toBe("evidence_examples");

    expect(getTableColumns(ontologyChangeSets).status.default).toBe("draft");
    expect(getTableColumns(ontologyChangeSetItems).change_set_id.notNull).toBe(
      true,
    );
    expect(
      getTableColumns(ontologyEvidenceExamples).change_set_id.notNull,
    ).toBe(true);
    expect(getTableColumns(ontologyEvidenceExamples).item_id.notNull).toBe(
      false,
    );

    expect(ONTOLOGY_CHANGE_SET_STATUSES).toEqual([
      "draft",
      "pending_review",
      "approved",
      "rejected",
      "applied",
    ]);
  });

  it("records suggestion scans and reprocess jobs independently", () => {
    expect(getTableName(ontologySuggestionScanJobs)).toBe(
      "suggestion_scan_jobs",
    );
    expect(getTableName(ontologyReprocessJobs)).toBe("reprocess_jobs");

    expect(getTableColumns(ontologySuggestionScanJobs).status.default).toBe(
      "pending",
    );
    expect(getTableColumns(ontologySuggestionScanJobs).result.notNull).toBe(
      true,
    );
    expect(
      getTableColumns(ontologyReprocessJobs).ontology_version_id.notNull,
    ).toBe(false);
    expect(getTableColumns(ontologyReprocessJobs).impact.notNull).toBe(true);

    expect(ONTOLOGY_JOB_STATUSES).toEqual([
      "pending",
      "running",
      "succeeded",
      "failed",
      "canceled",
    ]);
  });

  it("seeds approved customer, commitment, and risk definitions with templates", () => {
    expect(migration0098).toMatch(
      /\('customer', 'Customer', 'organization'[\s\S]*'approved'/,
    );
    expect(migration0098).toContain("('commitment', 'Commitment', 'promise'");
    expect(migration0098).toContain("('risk', 'Risk', 'risk'");
    expect(migration0098).toContain(
      "('customer', 'commitments', 'Commitments', 'operational'",
    );
    expect(migration0098).toContain(
      "('risk', 'assessment', 'Assessment', 'compiled'",
    );
  });

  it("lets two tenants use the same canonical type slug while rejecting duplicates per tenant", () => {
    expect(migration0098).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_entity_types_tenant_slug\s+ON ontology\.entity_types \(tenant_id, slug\)/,
    );
    expect(migration0098).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_relationship_types_tenant_slug\s+ON ontology\.relationship_types \(tenant_id, slug\)/,
    );
  });

  it("allows broad external mappings without changing the canonical entity slug", () => {
    expect(migration0098).toContain(
      "('customer', 'broad', 'schema.org', 'https://schema.org/Organization'",
    );
    expect(migration0098).toContain(
      "Customer is tenant-specific and can include prospects or accounts",
    );
  });

  it("rejects invalid lifecycle states, mapping kinds, and job states in SQL", () => {
    expect(migration0098).toMatch(
      /ontology_entity_types_lifecycle_allowed[\s\S]*'proposed'[\s\S]*'approved'[\s\S]*'deprecated'[\s\S]*'rejected'/,
    );
    expect(migration0098).toMatch(
      /ontology_external_mappings_kind_allowed[\s\S]*'exact'[\s\S]*'close'[\s\S]*'broad'[\s\S]*'narrow'[\s\S]*'related'/,
    );
    expect(migration0098).toMatch(
      /ontology_suggestion_scan_jobs_status_allowed[\s\S]*'pending'[\s\S]*'running'[\s\S]*'succeeded'[\s\S]*'failed'[\s\S]*'canceled'/,
    );
  });

  it("records approval version boundaries without deleting change evidence", () => {
    expect(migration0098).toContain("source_change_set_id uuid");
    expect(migration0098).toContain("applied_version_id uuid");
    expect(migration0098).toContain(
      "CREATE TABLE IF NOT EXISTS ontology.evidence_examples",
    );
    expect(migration0098).not.toMatch(
      /DELETE FROM ontology\.evidence_examples/,
    );
  });

  it("uses idempotent seed insertions for tenant bootstrap", () => {
    expect(migration0098).toMatch(
      /INSERT INTO ontology\.versions[\s\S]*ON CONFLICT \(tenant_id, version_number\) DO NOTHING/,
    );
    expect(migration0098).toMatch(
      /INSERT INTO ontology\.entity_types[\s\S]*ON CONFLICT \(tenant_id, slug\) DO NOTHING/,
    );
    expect(migration0098).toMatch(
      /INSERT INTO ontology\.facet_templates[\s\S]*ON CONFLICT \(entity_type_id, slug\) DO NOTHING/,
    );
  });
});
