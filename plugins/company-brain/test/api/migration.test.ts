import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrainArtifactManifestRow,
  BrainMigrationDeps,
  BrainSubstrateMigrationRow,
  BrainSubstrateStateRow,
} from "../../src/api/migration.js";
import {
  requestCompanyBrainProductionMigration,
  updateCompanyBrainMigration,
} from "../../src/api/migration.js";

const now = new Date("2026-06-14T12:00:00.000Z");

function substrate(
  overrides: Partial<BrainSubstrateStateRow> = {},
): BrainSubstrateStateRow {
  return {
    id: "substrate-1",
    tenant_id: "tenant-1",
    managed_application_id: "app-1",
    latest_deployment_job_id: "job-1",
    storage_tier: "default",
    active_backend: "default",
    status: "ready",
    health_status: "healthy",
    backend_mode: "default",
    graph_provider: "cognee",
    vector_provider: "postgres",
    embedding_model: "amazon.titan-embed-text-v2:0",
    vector_dimension: 1024,
    cognee_version: "0.2.0",
    cognee_endpoint: "https://cognee.internal.example.com",
    s3_artifact_root: "s3://brain-artifacts/tenant-1/",
    s3_manifest_root: "s3://brain-manifests/tenant-1/",
    s3_vault_projection_root: "s3://brain-vault/tenant-1/",
    neptune_graph_id: null,
    neptune_endpoint: null,
    efs_file_system_id: null,
    production_posture: null,
    latest_ingest_at: null,
    latest_projection_at: null,
    ingestion_queue_depth: 0,
    failed_ingest_count: 0,
    graph_entity_count: null,
    graph_edge_count: null,
    source_artifact_count: null,
    vault_projection_count: null,
    ontology_version: null,
    launch_capabilities: {},
    optional_capabilities: {},
    operator_evidence: { smoke: "pass" },
    last_failure_message: null,
    last_failure_at: null,
    created_at: new Date("2026-06-14T11:00:00.000Z"),
    updated_at: new Date("2026-06-14T11:30:00.000Z"),
    ...overrides,
  };
}

function manifest(
  overrides: Partial<BrainArtifactManifestRow> = {},
): BrainArtifactManifestRow {
  return {
    id: "manifest-1",
    tenant_id: "tenant-1",
    substrate_id: "substrate-1",
    migration_id: null,
    ingest_run_id: "ingest-1",
    manifest_kind: "source_artifact",
    storage_tier: "default",
    source_family: "threads",
    source_kind: "thread",
    source_type: "thread",
    source_ids: ["thread-1"],
    source_id_hash: "hash-1",
    manifest_uri: "s3://brain-manifests/tenant-1/manifest-1.json",
    artifact_root_uri: "s3://brain-artifacts/tenant-1/thread-1/",
    vault_projection_root_uri: null,
    object_version_id: null,
    content_type: "application/json",
    content_encoding: null,
    byte_length: 512,
    checksum_sha256: "sha256",
    object_count: 3,
    source_count: 1,
    embedding_model: "amazon.titan-embed-text-v2:0",
    vector_dimension: 1024,
    ontology_version: "company-brain-v1",
    ontology_mechanism: "default",
    status: "active",
    metadata: {},
    created_at: new Date("2026-06-14T11:00:00.000Z"),
    updated_at: new Date("2026-06-14T11:30:00.000Z"),
    ...overrides,
  };
}

function migration(
  overrides: Partial<BrainSubstrateMigrationRow> = {},
): BrainSubstrateMigrationRow {
  return {
    id: "migration-1",
    tenant_id: "tenant-1",
    substrate_id: "substrate-1",
    from_storage_tier: "default",
    to_storage_tier: "production",
    phase: "validating",
    status: "running",
    requested_by_user_id: "user-1",
    deployment_job_id: null,
    embedding_model: "amazon.titan-embed-text-v2:0",
    vector_dimension: 1024,
    validation_summary: { validationPassed: false, vectorDimension: 1024 },
    operator_evidence: { runbook: "checked" },
    error_message: null,
    requested_at: new Date("2026-06-14T11:40:00.000Z"),
    started_at: new Date("2026-06-14T11:41:00.000Z"),
    completed_at: null,
    rollback_window_closes_at: null,
    created_at: new Date("2026-06-14T11:40:00.000Z"),
    updated_at: new Date("2026-06-14T11:50:00.000Z"),
    ...overrides,
  };
}

function deps(args: {
  substrate?: BrainSubstrateStateRow | null;
  migration?: BrainSubstrateMigrationRow | null;
  activeMigration?: BrainSubstrateMigrationRow | null;
  manifests?: BrainArtifactManifestRow[];
}) {
  const state = {
    substrate: args.substrate ?? substrate(),
    migration: args.migration ?? migration(),
  };
  const testDeps: BrainMigrationDeps & {
    createdMigrations: BrainSubstrateMigrationRow[];
    migrationPatches: Array<Partial<BrainSubstrateMigrationRow>>;
    substratePatches: Array<Partial<BrainSubstrateStateRow>>;
    events: Array<Record<string, unknown>>;
  } = {
    createdMigrations: [],
    migrationPatches: [],
    substratePatches: [],
    events: [],
    getSubstrateState: vi.fn(async () => state.substrate),
    getMigration: vi.fn(async () => state.migration),
    getActiveMigration: vi.fn(async () => args.activeMigration ?? null),
    listReplayManifests: vi.fn(async () => args.manifests ?? [manifest()]),
    createMigration: vi.fn(async (values) => {
      const created = migration({
        ...values,
        id: "migration-new",
        phase: values.phase ?? "requested",
        status: values.status ?? "requested",
      });
      testDeps.createdMigrations.push(created);
      state.migration = created;
      return created;
    }),
    updateMigration: vi.fn(async ({ patch }) => {
      testDeps.migrationPatches.push(patch);
      const updated = migration({ ...state.migration, ...patch });
      state.migration = updated;
      return updated;
    }),
    updateSubstrate: vi.fn(async ({ patch }) => {
      testDeps.substratePatches.push(patch);
      if (state.substrate)
        state.substrate = substrate({ ...state.substrate, ...patch });
    }),
    appendEvent: vi.fn(async (event) => {
      testDeps.events.push(event as Record<string, unknown>);
    }),
    now: () => now,
  };
  return testDeps;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("requestCompanyBrainProductionMigration", () => {
  it("creates a requested migration and marks the default substrate as migrating", async () => {
    const testDeps = deps({});

    const result = await requestCompanyBrainProductionMigration(
      {
        tenantId: "tenant-1",
        requestedByUserId: "user-1",
        operatorEvidence: { ticket: "THNK-6" },
      },
      testDeps,
    );

    expect(result).toMatchObject({
      id: "migration-new",
      from_storage_tier: "default",
      to_storage_tier: "production",
      phase: "requested",
      status: "requested",
      embedding_model: "amazon.titan-embed-text-v2:0",
      vector_dimension: 1024,
      requested_by_user_id: "user-1",
      validation_summary: expect.objectContaining({
        replayManifestCount: 1,
        sourceCount: 1,
        objectCount: 3,
        validationPassed: false,
      }),
    });
    expect(testDeps.substratePatches.at(-1)).toMatchObject({
      status: "migrating",
      health_status: "degraded",
      operator_evidence: {
        smoke: "pass",
        latestMigrationId: "migration-new",
      },
    });
    expect(testDeps.events.at(-1)).toMatchObject({
      event_type: "brain.migration.requested",
      migration_id: "migration-new",
    });
  });

  it("requires explicit empty-source approval before migrating without replay manifests", async () => {
    const testDeps = deps({ manifests: [] });

    await expect(
      requestCompanyBrainProductionMigration(
        { tenantId: "tenant-1" },
        testDeps,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(testDeps.createdMigrations).toHaveLength(0);
    expect(testDeps.substratePatches).toHaveLength(0);
  });

  it("rejects manifests whose vector dimension does not match the target", async () => {
    const testDeps = deps({
      manifests: [
        manifest({ id: "manifest-mismatch", vector_dimension: 1536 }),
      ],
    });

    await expect(
      requestCompanyBrainProductionMigration(
        { tenantId: "tenant-1", vectorDimension: 1024 },
        testDeps,
      ),
    ).rejects.toThrow(/vector dimension/i);
    expect(testDeps.createdMigrations).toHaveLength(0);
  });

  it("rejects duplicate active migrations before creating another row", async () => {
    const testDeps = deps({
      activeMigration: migration({ id: "migration-active", status: "running" }),
    });

    await expect(
      requestCompanyBrainProductionMigration(
        { tenantId: "tenant-1" },
        testDeps,
      ),
    ).rejects.toThrow(/already active/i);
    expect(testDeps.createdMigrations).toHaveLength(0);
    expect(testDeps.substratePatches).toHaveLength(0);
  });

  it("only allows requests from ready default substrates", async () => {
    const testDeps = deps({
      substrate: substrate({ status: "migrating" }),
    });

    await expect(
      requestCompanyBrainProductionMigration(
        { tenantId: "tenant-1" },
        testDeps,
      ),
    ).rejects.toThrow(/migrating/i);
    expect(testDeps.getActiveMigration).not.toHaveBeenCalled();
    expect(testDeps.createdMigrations).toHaveLength(0);
  });
});

describe("updateCompanyBrainMigration", () => {
  it("refuses cutover until validation evidence passes", async () => {
    const testDeps = deps({
      migration: migration({
        phase: "validating",
        validation_summary: { validationPassed: false, vectorDimension: 1024 },
      }),
    });

    await expect(
      updateCompanyBrainMigration(
        {
          tenantId: "tenant-1",
          migrationId: "migration-1",
          phase: "cutover",
        },
        testDeps,
      ),
    ).rejects.toThrow(/validationPassed/i);
    expect(testDeps.migrationPatches).toHaveLength(0);
    expect(testDeps.substratePatches).toHaveLength(0);
  });

  it("promotes the active backend to production when validation completes", async () => {
    const testDeps = deps({
      migration: migration({
        phase: "cutover",
        validation_summary: { validationPassed: true, vectorDimension: 1024 },
      }),
    });

    const result = await updateCompanyBrainMigration(
      {
        tenantId: "tenant-1",
        migrationId: "migration-1",
        phase: "completed",
        status: "completed",
        validationSummary: { validationPassed: true, vectorDimension: 1024 },
      },
      testDeps,
    );

    expect(result).toMatchObject({
      phase: "completed",
      status: "completed",
      completed_at: now,
    });
    expect(testDeps.substratePatches.at(-1)).toMatchObject({
      storage_tier: "production",
      active_backend: "production",
      status: "ready",
      health_status: "healthy",
      operator_evidence: {
        smoke: "pass",
        latestMigrationId: "migration-1",
        activeMigrationCompletedAt: now.toISOString(),
      },
    });
    expect(testDeps.events.at(-1)).toMatchObject({
      event_type: "brain.migration.completed",
      payload: expect.objectContaining({
        phase: "completed",
        status: "completed",
      }),
    });
  });

  it("keeps the default backend active when a migration rolls back", async () => {
    const testDeps = deps({
      migration: migration({
        phase: "failed",
        status: "failed",
        validation_summary: { validationPassed: true, vectorDimension: 1024 },
      }),
    });

    await updateCompanyBrainMigration(
      {
        tenantId: "tenant-1",
        migrationId: "migration-1",
        phase: "rolled_back",
        status: "rolled_back",
      },
      testDeps,
    );

    expect(testDeps.substratePatches.at(-1)).toMatchObject({
      storage_tier: "default",
      active_backend: "default",
      status: "ready",
      health_status: "healthy",
    });
  });

  it("rejects skipped phase transitions before cutover", async () => {
    const testDeps = deps({
      migration: migration({
        phase: "requested",
        status: "requested",
        validation_summary: { validationPassed: true, vectorDimension: 1024 },
      }),
    });

    await expect(
      updateCompanyBrainMigration(
        {
          tenantId: "tenant-1",
          migrationId: "migration-1",
          phase: "completed",
          status: "completed",
          validationSummary: { validationPassed: true, vectorDimension: 1024 },
        },
        testDeps,
      ),
    ).rejects.toThrow(/phase transition/i);
    expect(testDeps.migrationPatches).toHaveLength(0);
    expect(testDeps.substratePatches).toHaveLength(0);
  });

  it("rejects terminal statuses that do not match the requested phase", async () => {
    const testDeps = deps({
      migration: migration({
        phase: "validating",
        validation_summary: { validationPassed: true, vectorDimension: 1024 },
      }),
    });

    await expect(
      updateCompanyBrainMigration(
        {
          tenantId: "tenant-1",
          migrationId: "migration-1",
          phase: "validating",
          status: "completed",
        },
        testDeps,
      ),
    ).rejects.toThrow(/status does not match phase/i);
    expect(testDeps.migrationPatches).toHaveLength(0);
    expect(testDeps.substratePatches).toHaveLength(0);
  });

  it("redacts raw validation details from the public summary", async () => {
    const testDeps = deps({
      migration: migration({
        phase: "replaying",
        validation_summary: {
          sourceCount: 1,
          rawSourceIds: ["thread-secret"],
        },
      }),
    });

    const result = await updateCompanyBrainMigration(
      {
        tenantId: "tenant-1",
        migrationId: "migration-1",
        phase: "validating",
        validationSummary: {
          validationPassed: false,
          vectorDimension: 1024,
          rawS3Uri: "s3://private-bucket/key",
        },
      },
      testDeps,
    );

    expect(result.validation_summary).toEqual({
      sourceCount: 1,
      vectorDimension: 1024,
      validationPassed: false,
    });
    expect(JSON.stringify(result.validation_summary)).not.toContain("s3://");
    expect(JSON.stringify(result.validation_summary)).not.toContain(
      "thread-secret",
    );
  });
});
