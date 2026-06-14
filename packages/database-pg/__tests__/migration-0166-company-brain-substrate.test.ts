import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  BRAIN_ACTIVE_BACKENDS,
  BRAIN_ARTIFACT_MANIFEST_KINDS,
  BRAIN_ARTIFACT_MANIFEST_STATUSES,
  BRAIN_MIGRATION_PHASES,
  BRAIN_MIGRATION_STATUSES,
  BRAIN_STORAGE_TIERS,
  BRAIN_SUBSTRATE_HEALTH_STATUSES,
  BRAIN_SUBSTRATE_STATUSES,
  brainArtifactManifests,
  brainSubstrateEvents,
  brainSubstrateMigrations,
  brainSubstrateStates,
} from "../src/schema/brain";
import * as schema from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0166 = readFileSync(
  join(HERE, "..", "drizzle", "0166_company_brain_substrate_contract.sql"),
  "utf-8",
);
const brainTypes = readFileSync(
  join(HERE, "..", "graphql", "types", "brain.graphql"),
  "utf-8",
);

describe("migration 0166 — Company Brain substrate contract", () => {
  it("exports substrate tables and vocabularies from the schema index", () => {
    expect(schema.brainSubstrateStates).toBe(brainSubstrateStates);
    expect(schema.brainSubstrateMigrations).toBe(brainSubstrateMigrations);
    expect(schema.brainSubstrateEvents).toBe(brainSubstrateEvents);
    expect(schema.brainArtifactManifests).toBe(brainArtifactManifests);
    expect(schema.BRAIN_STORAGE_TIERS).toBe(BRAIN_STORAGE_TIERS);
    expect(schema.BRAIN_SUBSTRATE_STATUSES).toBe(BRAIN_SUBSTRATE_STATUSES);
    expect(schema.BRAIN_SUBSTRATE_HEALTH_STATUSES).toBe(
      BRAIN_SUBSTRATE_HEALTH_STATUSES,
    );
    expect(schema.BRAIN_ACTIVE_BACKENDS).toBe(BRAIN_ACTIVE_BACKENDS);
    expect(schema.BRAIN_MIGRATION_PHASES).toBe(BRAIN_MIGRATION_PHASES);
    expect(schema.BRAIN_MIGRATION_STATUSES).toBe(BRAIN_MIGRATION_STATUSES);
    expect(schema.BRAIN_ARTIFACT_MANIFEST_KINDS).toBe(
      BRAIN_ARTIFACT_MANIFEST_KINDS,
    );
    expect(schema.BRAIN_ARTIFACT_MANIFEST_STATUSES).toBe(
      BRAIN_ARTIFACT_MANIFEST_STATUSES,
    );
  });

  it("models one substrate state row per tenant with redacted evidence fields separated", () => {
    expect(getTableName(brainSubstrateStates)).toBe("substrate_states");
    const columns = getTableColumns(brainSubstrateStates);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.storage_tier.notNull).toBe(true);
    expect(columns.storage_tier.default).toBe("default");
    expect(columns.active_backend.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
    expect(columns.health_status.notNull).toBe(true);
    expect(columns.cognee_endpoint.notNull).toBe(false);
    expect(columns.s3_artifact_root.notNull).toBe(false);
    expect(columns.neptune_graph_id.notNull).toBe(false);
    expect(columns.efs_file_system_id.notNull).toBe(false);
    expect(columns.launch_capabilities.notNull).toBe(true);
    expect(columns.optional_capabilities.notNull).toBe(true);
    expect(columns.operator_evidence.notNull).toBe(true);

    const config = getTableConfig(brainSubstrateStates);
    const indexes = config.indexes.map((index) => index.config.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "brain_substrate_states_tenant_uidx",
        "brain_substrate_states_tenant_status_idx",
        "brain_substrate_states_managed_app_idx",
        "brain_substrate_states_latest_job_idx",
        "brain_substrate_states_storage_tier_idx",
      ]),
    );
    expect(
      config.indexes.find(
        (index) => index.config.name === "brain_substrate_states_tenant_uidx",
      )?.config.unique,
    ).toBe(true);
    expect(config.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "brain_substrate_states_tier_allowed",
        "brain_substrate_states_backend_allowed",
        "brain_substrate_states_status_allowed",
        "brain_substrate_states_health_allowed",
        "brain_substrate_states_vector_positive",
      ]),
    );
  });

  it("models migration phases, substrate events, and replayable artifact manifests", () => {
    expect(getTableName(brainSubstrateMigrations)).toBe("substrate_migrations");
    expect(getTableName(brainSubstrateEvents)).toBe("substrate_events");
    expect(getTableName(brainArtifactManifests)).toBe("artifact_manifests");

    const migrationColumns = getTableColumns(brainSubstrateMigrations);
    expect(migrationColumns.tenant_id.notNull).toBe(true);
    expect(migrationColumns.from_storage_tier.default).toBe("default");
    expect(migrationColumns.to_storage_tier.default).toBe("production");
    expect(migrationColumns.phase.default).toBe("none");
    expect(migrationColumns.status.default).toBe("none");
    expect(migrationColumns.validation_summary.notNull).toBe(true);
    expect(migrationColumns.operator_evidence.notNull).toBe(true);

    const eventColumns = getTableColumns(brainSubstrateEvents);
    expect(eventColumns.tenant_id.notNull).toBe(true);
    expect(eventColumns.event_type.notNull).toBe(true);
    expect(eventColumns.message.notNull).toBe(true);
    expect(eventColumns.payload.notNull).toBe(true);

    const manifestColumns = getTableColumns(brainArtifactManifests);
    expect(manifestColumns.manifest_kind.notNull).toBe(true);
    expect(manifestColumns.manifest_uri.notNull).toBe(true);
    expect(manifestColumns.object_count.notNull).toBe(true);
    expect(manifestColumns.source_count.notNull).toBe(true);
    expect(manifestColumns.status.default).toBe("active");
  });

  it("keeps substrate FK and index names within Postgres's 63-char limit", () => {
    for (const table of [
      brainSubstrateStates,
      brainSubstrateMigrations,
      brainSubstrateEvents,
      brainArtifactManifests,
    ]) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        expect(fk.getName().length).toBeLessThanOrEqual(63);
      }
      for (const index of config.indexes) {
        expect(String(index.config.name).length).toBeLessThanOrEqual(63);
      }
    }
    expect(
      getTableConfig(brainSubstrateStates).foreignKeys.map((fk) =>
        fk.getName(),
      ),
    ).toEqual(
      expect.arrayContaining([
        "substrate_states_managed_application_id_fk",
        "substrate_states_latest_deployment_job_id_fk",
      ]),
    );
    expect(
      getTableConfig(brainSubstrateMigrations).foreignKeys.map((fk) =>
        fk.getName(),
      ),
    ).toContain("substrate_migrations_deployment_job_id_fk");
  });

  it("pins the storage-tier, backend, status, migration, and manifest vocabularies", () => {
    expect(BRAIN_STORAGE_TIERS).toEqual(["default", "production"]);
    expect(BRAIN_ACTIVE_BACKENDS).toEqual([
      "none",
      "default",
      "production",
      "legacy_cognee",
    ]);
    expect(BRAIN_SUBSTRATE_STATUSES).toEqual([
      "not_installed",
      "provisioning",
      "ready",
      "degraded",
      "failed",
      "migrating",
      "disabled",
    ]);
    expect(BRAIN_SUBSTRATE_HEALTH_STATUSES).toEqual([
      "unknown",
      "healthy",
      "degraded",
      "failed",
      "disabled",
    ]);
    expect(BRAIN_MIGRATION_PHASES).toContain("cutover");
    expect(BRAIN_MIGRATION_STATUSES).toContain("rolled_back");
    expect(BRAIN_ARTIFACT_MANIFEST_KINDS).toEqual([
      "source_artifact",
      "ingestion_manifest",
      "migration_snapshot",
      "vault_projection",
      "export",
    ]);
    expect(BRAIN_ARTIFACT_MANIFEST_STATUSES).toEqual([
      "active",
      "superseded",
      "deleted",
      "failed",
    ]);
  });

  it("declares drift markers for substrate tables, indexes, and constraints", () => {
    for (const marker of [
      "brain.substrate_states",
      "brain.substrate_migrations",
      "brain.substrate_events",
      "brain.artifact_manifests",
      "brain.brain_substrate_states_tenant_uidx",
      "brain.brain_substrate_migrations_job_idx",
      "brain.brain_substrate_events_deployment_job_idx",
      "brain.brain_artifact_manifests_manifest_uri_uidx",
    ]) {
      expect(migration0166).toMatch(
        new RegExp(`--\\s*creates:\\s*${marker}\\b`),
      );
    }

    for (const marker of [
      "brain.substrate_states.substrate_states_managed_application_id_fk",
      "brain.substrate_states.substrate_states_latest_deployment_job_id_fk",
      "brain.substrate_migrations.substrate_migrations_deployment_job_id_fk",
      "brain.substrate_events.substrate_events_deployment_job_id_fk",
      "brain.artifact_manifests.artifact_manifests_migration_id_fk",
      "brain.substrate_states.brain_substrate_states_tier_allowed",
      "brain.substrate_migrations.brain_substrate_migrations_phase_allowed",
      "brain.artifact_manifests.brain_artifact_manifests_kind_allowed",
    ]) {
      expect(migration0166).toMatch(
        new RegExp(`--\\s*creates-constraint:\\s*${marker}\\b`),
      );
      expect(migration0166).toContain(marker.split(".").pop());
    }
  });

  it("exposes a query-only GraphQL status contract with operator evidence separated", () => {
    expect(brainTypes).toContain("type CompanyBrainStatus");
    expect(brainTypes).toContain("type CompanyBrainOperatorEvidence");
    expect(brainTypes).toContain("type CompanyBrainMigrationStatus");
    expect(brainTypes).toMatch(
      /type CompanyBrainStatus[\s\S]*?evidence: CompanyBrainOperatorEvidence/,
    );
    expect(brainTypes).toContain("companyBrainStatus: CompanyBrainStatus!");
    expect(brainTypes).not.toContain("mutation");
  });
});
