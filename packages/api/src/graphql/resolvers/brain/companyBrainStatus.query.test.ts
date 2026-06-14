import { GraphQLError } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrainSubstrateMigrationRow,
  BrainSubstrateStateRow,
  CompanyBrainStatusResolverDeps,
} from "./companyBrainStatus.query.js";

const {
  mockRequireAdminOrServiceCaller,
  mockRequireTenantMember,
  mockResolveCallerTenantId,
} = vi.hoisted(() => ({
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockRequireTenantMember: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

let mod: typeof import("./companyBrainStatus.query.js");

const memberCtx = { auth: { authType: "cognito" } } as any;
const serviceCtx = {
  auth: { authType: "service", tenantId: "tenant-1" },
} as any;

function forbidden(message = "Tenant admin role required") {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN" },
  });
}

function explicitState(
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
    latest_ingest_at: new Date("2026-06-14T10:00:00.000Z"),
    latest_projection_at: new Date("2026-06-14T10:05:00.000Z"),
    ingestion_queue_depth: 0,
    failed_ingest_count: 0,
    graph_entity_count: 12,
    graph_edge_count: 20,
    source_artifact_count: 5,
    vault_projection_count: 3,
    ontology_version: "company-brain-v1",
    launch_capabilities: {
      coreIngest: "enabled",
      retrieval: "enabled",
      provenance: "enabled",
      s3Replay: "enabled",
      brainMcpPolicyChecks: "enabled",
    },
    optional_capabilities: {},
    operator_evidence: { smoke: "pass" },
    last_failure_message: null,
    last_failure_at: null,
    created_at: new Date("2026-06-14T09:00:00.000Z"),
    updated_at: new Date("2026-06-14T10:05:00.000Z"),
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
    deployment_job_id: "job-2",
    embedding_model: "amazon.titan-embed-text-v2:0",
    vector_dimension: 1024,
    validation_summary: { replayed: true },
    operator_evidence: { evidenceUri: "s3://brain-evidence/job-2/" },
    error_message: null,
    requested_at: new Date("2026-06-14T10:10:00.000Z"),
    started_at: new Date("2026-06-14T10:11:00.000Z"),
    completed_at: null,
    rollback_window_closes_at: null,
    created_at: new Date("2026-06-14T10:10:00.000Z"),
    updated_at: new Date("2026-06-14T10:15:00.000Z"),
    ...overrides,
  };
}

function deps(args: {
  row?: BrainSubstrateStateRow | null;
  migration?: BrainSubstrateMigrationRow | null;
  legacy?: {
    enabled: boolean;
    endpoint: string | null;
    backendMode: string | null;
  };
}): CompanyBrainStatusResolverDeps & {
  getSubstrateState: ReturnType<typeof vi.fn>;
  getLatestMigration: ReturnType<typeof vi.fn>;
  readLegacyCogneeStatus: ReturnType<typeof vi.fn>;
} {
  return {
    getSubstrateState: vi.fn(async () => args.row ?? null),
    getLatestMigration: vi.fn(async () => args.migration ?? null),
    readLegacyCogneeStatus: vi.fn(
      () =>
        args.legacy ?? {
          enabled: false,
          endpoint: null,
          backendMode: null,
        },
    ),
  };
}

beforeEach(async () => {
  vi.resetModules();
  mockRequireAdminOrServiceCaller.mockReset().mockRejectedValue(forbidden());
  mockRequireTenantMember.mockReset().mockResolvedValue("member");
  mockResolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  mod = await import("./companyBrainStatus.query.js");
});

describe("companyBrainStatus", () => {
  it("returns default-tier coarse status to tenant members without operator evidence", async () => {
    const reader = deps({ row: explicitState(), migration: null });

    const result = await mod.companyBrainStatus(null, {}, memberCtx, reader);

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      memberCtx,
      "tenant-1",
      "company_brain_status:read_evidence",
    );
    expect(mockRequireTenantMember).toHaveBeenCalledWith(memberCtx, "tenant-1");
    expect(result).toMatchObject({
      tenantId: "tenant-1",
      storageTier: "default",
      activeBackend: "default",
      status: "ready",
      healthStatus: "healthy",
      evidence: null,
      counters: {
        ingestionQueueDepth: 0,
        failedIngestCount: 0,
        graphEntityCount: 12,
        graphEdgeCount: 20,
      },
    });
    expect(
      result.capabilities.optional.find(
        (capability) => capability.key === "sessionPromotion",
      ),
    ).toMatchObject({ status: "disabled" });
    expect(JSON.stringify(result)).not.toContain("cognee.internal.example.com");
    expect(JSON.stringify(result)).not.toContain("s3://brain-artifacts");
  });

  it("returns production substrate evidence to operator/service callers", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValueOnce(undefined);
    const reader = deps({
      row: explicitState({
        storage_tier: "production",
        active_backend: "production",
        backend_mode: "neptune",
        graph_provider: "neptune_analytics",
        vector_provider: "neptune_analytics",
        neptune_graph_id: "graph-prod-1",
        neptune_endpoint: "https://neptune.internal.example.com",
        efs_file_system_id: "fs-1234567890",
        production_posture: "active",
      }),
      migration: migration(),
    });

    const result = await mod.companyBrainStatus(null, {}, serviceCtx, reader);

    expect(mockRequireTenantMember).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      storageTier: "production",
      activeBackend: "production",
      migration: {
        id: "migration-1",
        phase: "validating",
        status: "running",
        validationSummary: JSON.stringify({ replayed: true }),
      },
      evidence: {
        managedApplicationId: "app-1",
        latestDeploymentJobId: "job-1",
        backendMode: "neptune",
        graphProvider: "neptune_analytics",
        vectorProvider: "neptune_analytics",
        cogneeEndpoint: "https://cognee.internal.example.com",
        s3ArtifactRoot: "s3://brain-artifacts/tenant-1/",
        neptuneGraphId: "graph-prod-1",
        neptuneEndpoint: "https://neptune.internal.example.com",
        efsFileSystemId: "fs-1234567890",
        productionPosture: "active",
        operatorEvidence: JSON.stringify({ smoke: "pass" }),
        migrationEvidence: JSON.stringify({
          evidenceUri: "s3://brain-evidence/job-2/",
        }),
      },
    });
    expect(result.evidence).not.toHaveProperty("openSearchEndpoint");
    expect(JSON.stringify(result.evidence).toLowerCase()).not.toContain(
      "opensearch",
    );
  });

  it("keeps explicit substrate state authoritative over legacy Cognee env status", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValueOnce(undefined);
    const reader = deps({
      row: explicitState({
        storage_tier: "production",
        active_backend: "production",
        cognee_endpoint: "https://explicit.cognee.example.com",
      }),
      legacy: {
        enabled: true,
        endpoint: "https://legacy.cognee.example.com",
        backendMode: "legacy-graphiti",
      },
    });

    const result = await mod.companyBrainStatus(null, {}, serviceCtx, reader);

    expect(reader.readLegacyCogneeStatus).not.toHaveBeenCalled();
    expect(result.storageTier).toBe("production");
    expect(result.activeBackend).toBe("production");
    expect(result.evidence?.cogneeEndpoint).toBe(
      "https://explicit.cognee.example.com",
    );
  });

  it("falls back to a degraded legacy Cognee projection only when no substrate row exists", async () => {
    mockRequireAdminOrServiceCaller.mockResolvedValueOnce(undefined);
    const reader = deps({
      row: null,
      legacy: {
        enabled: true,
        endpoint: "https://legacy.cognee.example.com",
        backendMode: "graphiti",
      },
    });

    const result = await mod.companyBrainStatus(null, {}, serviceCtx, reader);

    expect(reader.getLatestMigration).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      storageTier: "default",
      activeBackend: "legacy_cognee",
      status: "ready",
      healthStatus: "degraded",
      evidence: {
        backendMode: "graphiti",
        cogneeEndpoint: "https://legacy.cognee.example.com",
        productionPosture: "legacy_env_projection",
      },
    });
    expect(
      result.capabilities.launch.find(
        (capability) => capability.key === "retrieval",
      ),
    ).toMatchObject({ status: "degraded", source: "legacy_cognee_env" });
    expect(
      result.capabilities.optional.find(
        (capability) => capability.key === "globalContextIndex",
      ),
    ).toMatchObject({ status: "disabled" });
  });

  it("fails closed before reading substrate state when the caller is not a tenant member", async () => {
    mockRequireTenantMember.mockRejectedValueOnce(
      forbidden("Tenant membership required"),
    );
    const reader = deps({ row: explicitState() });

    await expect(
      mod.companyBrainStatus(null, {}, memberCtx, reader),
    ).rejects.toThrow(/tenant membership/i);

    expect(reader.getSubstrateState).not.toHaveBeenCalled();
    expect(reader.getLatestMigration).not.toHaveBeenCalled();
  });
});
