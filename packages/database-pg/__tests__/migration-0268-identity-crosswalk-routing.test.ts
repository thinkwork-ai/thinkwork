import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  ENTITY_MAPPING_CREATED_BY,
  ENTITY_RESOLUTION_EVENT_TYPES,
  IDENTITY_MATCH_JOB_STATUSES,
  MAPPING_CANDIDATE_SET_STATUSES,
  MAPPING_REJECTION_CREATED_BY,
  entitySourceMappings,
  identityMatchJobs,
  mappingCandidateSets,
  mappingRejections,
  sourceSystemConnectors,
} from "../src/schema/entity-identity";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0268_identity_crosswalk_routing.sql"),
  "utf8",
);

describe("migration 0268 identity crosswalk routing", () => {
  it("widens the mapping created_by and event_type vocabularies idempotently", () => {
    expect(migration).toContain(
      "-- creates-column: identity.entity_source_mappings.created_by_user_id",
    );
    expect(migration).toContain(
      "-- creates-column: identity.entity_source_mappings.created_thread_ref",
    );
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS created_by_user_id uuid/,
    );
    expect(migration).toMatch(
      /CHECK \(created_by IN \('rule','operator','backfill','user'\)\)/,
    );
    expect(migration).toMatch(
      /CHECK \(event_type IN \('create','link','defer','reject','merge','revoke','split'\)\)/,
    );
    // Widening pattern: drop-then-add under the same constraint name.
    expect(migration).toMatch(
      /DROP CONSTRAINT IF EXISTS entity_source_mappings_created_by_allowed/,
    );
    expect(migration).toMatch(
      /DROP CONSTRAINT IF EXISTS entity_resolution_events_type_allowed/,
    );
  });

  it("declares every created object with a marker", () => {
    for (const marker of [
      "-- creates: identity.mapping_rejections",
      "-- creates: identity.uq_mapping_rejections_pairing",
      "-- creates: identity.idx_mapping_rejections_tenant_canonical",
      "-- creates: identity.source_system_connectors",
      "-- creates: identity.match_jobs",
      "-- creates: identity.uq_identity_match_jobs_dedupe",
      "-- creates: identity.idx_identity_match_jobs_tenant_status",
      "-- creates: identity.mapping_candidate_sets",
      "-- creates: identity.idx_mapping_candidate_sets_tenant_thread",
      "-- creates-constraint: identity.mapping_rejections.mapping_rejections_created_by_allowed",
      "-- creates-constraint: identity.source_system_connectors.source_system_connectors_connector_slug_fk",
      "-- creates-constraint: identity.match_jobs.match_jobs_status_allowed",
      "-- creates-constraint: identity.mapping_candidate_sets.mapping_candidate_sets_status_allowed",
    ]) {
      expect(migration).toContain(marker);
    }
  });

  it("links source systems to tenant connectors via the composite slug FK", () => {
    expect(migration).toMatch(/PRIMARY KEY \(tenant_id, source_system\)/);
    expect(migration).toMatch(
      /REFERENCES public\.tenant_mcp_servers \(tenant_id, slug\)/,
    );
  });

  it("mirrors the suggestion-scan dedupe uniqueness on match jobs", () => {
    expect(migration).toMatch(
      /uq_identity_match_jobs_dedupe\s+ON identity\.match_jobs \(tenant_id, dedupe_key\)\s+WHERE dedupe_key IS NOT NULL/,
    );
    expect(migration).toMatch(
      /CHECK \(status IN \('pending','running','succeeded','failed'\)\)/,
    );
  });
});

describe("identity crosswalk drizzle schema", () => {
  it("widens the created_by / event_type vocabularies", () => {
    expect(ENTITY_MAPPING_CREATED_BY).toEqual([
      "rule",
      "operator",
      "backfill",
      "user",
    ]);
    expect(ENTITY_RESOLUTION_EVENT_TYPES).toEqual([
      "create",
      "link",
      "defer",
      "reject",
      "merge",
      "revoke",
      "split",
    ]);
    const mappingColumns = getTableColumns(entitySourceMappings);
    expect(mappingColumns.created_by_user_id.notNull).toBe(false);
    expect(mappingColumns.created_thread_ref.notNull).toBe(false);
  });

  it("defines the negative-evidence store", () => {
    expect(getTableName(mappingRejections)).toBe("mapping_rejections");
    const columns = getTableColumns(mappingRejections);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.canonical_entity_id.notNull).toBe(true);
    expect(columns.namespace.default).toBe("");
    expect(columns.reason.notNull).toBe(false);
    expect(MAPPING_REJECTION_CREATED_BY).toEqual([
      "user",
      "operator",
      "rule",
      "system",
    ]);
  });

  it("defines connector links keyed by (tenant, source_system)", () => {
    expect(getTableName(sourceSystemConnectors)).toBe(
      "source_system_connectors",
    );
    const columns = getTableColumns(sourceSystemConnectors);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.source_system.notNull).toBe(true);
    expect(columns.connector_slug.notNull).toBe(true);
  });

  it("defines match jobs mirroring the suggestion-scan shape", () => {
    expect(getTableName(identityMatchJobs)).toBe("match_jobs");
    const columns = getTableColumns(identityMatchJobs);
    expect(columns.status.default).toBe("pending");
    expect(columns.trigger.default).toBe("manual");
    expect(columns.dedupe_key.notNull).toBe(false);
    expect(columns.error.notNull).toBe(false);
    expect(IDENTITY_MATCH_JOB_STATUSES).toEqual([
      "pending",
      "running",
      "succeeded",
      "failed",
    ]);
  });

  it("defines candidate sets with the echo-check lifecycle vocabulary", () => {
    expect(getTableName(mappingCandidateSets)).toBe("mapping_candidate_sets");
    const columns = getTableColumns(mappingCandidateSets);
    expect(columns.thread_ref.notNull).toBe(true);
    expect(columns.candidates.notNull).toBe(true);
    expect(columns.status.default).toBe("open");
    expect(columns.selected_candidate_id.notNull).toBe(false);
    expect(columns.expires_at.notNull).toBe(false);
    expect(MAPPING_CANDIDATE_SET_STATUSES).toEqual([
      "open",
      "confirmed",
      "declined",
      "superseded",
      "expired",
    ]);
  });
});
