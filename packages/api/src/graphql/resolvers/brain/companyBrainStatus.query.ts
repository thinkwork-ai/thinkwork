import { GraphQLError } from "graphql";
import { and, desc, eq } from "drizzle-orm";
import {
  brainSubstrateMigrations,
  brainSubstrateStates,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb } from "../../utils.js";
import {
  requireAdminOrServiceCaller,
  requireTenantMember,
} from "../core/authz.js";
import {
  readCogneeStatus,
  type CogneeStatus,
} from "../core/managedApplications.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

export type BrainSubstrateStateRow = typeof brainSubstrateStates.$inferSelect;
export type BrainSubstrateMigrationRow =
  typeof brainSubstrateMigrations.$inferSelect;

export interface CompanyBrainStatusResolverDeps {
  getSubstrateState(tenantId: string): Promise<BrainSubstrateStateRow | null>;
  getLatestMigration(args: {
    tenantId: string;
    substrateId: string;
  }): Promise<BrainSubstrateMigrationRow | null>;
  readLegacyCogneeStatus(): CogneeStatus;
}

export function createDrizzleCompanyBrainStatusDeps(
  db: typeof defaultDb = defaultDb,
): CompanyBrainStatusResolverDeps {
  return {
    async getSubstrateState(tenantId) {
      const [row] = await db
        .select()
        .from(brainSubstrateStates)
        .where(eq(brainSubstrateStates.tenant_id, tenantId))
        .limit(1);
      return row ?? null;
    },
    async getLatestMigration({ tenantId, substrateId }) {
      const [row] = await db
        .select()
        .from(brainSubstrateMigrations)
        .where(
          and(
            eq(brainSubstrateMigrations.tenant_id, tenantId),
            eq(brainSubstrateMigrations.substrate_id, substrateId),
          ),
        )
        .orderBy(desc(brainSubstrateMigrations.created_at))
        .limit(1);
      return row ?? null;
    },
    readLegacyCogneeStatus: readCogneeStatus,
  };
}

const LAUNCH_CAPABILITY_DEFAULTS = [
  "coreIngest",
  "retrieval",
  "provenance",
  "s3Replay",
  "brainMcpPolicyChecks",
] as const;

const OPTIONAL_CAPABILITY_DEFAULTS = [
  "sessionPromotion",
  "globalContextIndex",
  "feedbackInfluence",
  "temporalRecall",
  "tripletEmbeddings",
  "entityConsolidation",
  "structuredDltIngest",
  "memoryOnlyReset",
] as const;

type CapabilityStatus = "enabled" | "disabled" | "degraded" | "unknown";

const CAPABILITY_STATUSES = new Set<CapabilityStatus>([
  "enabled",
  "disabled",
  "degraded",
  "unknown",
]);

type JsonRecord = Record<string, unknown>;

type CompanyBrainCapability = {
  key: string;
  status: CapabilityStatus;
  message: string | null;
  source: string | null;
};

function tenantContextError(): GraphQLError {
  return new GraphQLError("Tenant context required", {
    extensions: { code: "FORBIDDEN" },
  });
}

function isAccessDenied(error: unknown): boolean {
  return (
    error instanceof GraphQLError &&
    (error.extensions.code === "FORBIDDEN" ||
      error.extensions.code === "UNAUTHENTICATED")
  );
}

async function canViewOperatorEvidence(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<boolean> {
  try {
    await requireAdminOrServiceCaller(
      ctx,
      tenantId,
      "company_brain_status:read_evidence",
    );
    return true;
  } catch (error) {
    if (isAccessDenied(error)) return false;
    throw error;
  }
}

function jsonRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function jsonScalar(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeCapabilityStatus(
  value: unknown,
  fallback: CapabilityStatus,
): CapabilityStatus {
  if (typeof value !== "string") return fallback;
  const lowered = value.trim().toLowerCase();
  return CAPABILITY_STATUSES.has(lowered as CapabilityStatus)
    ? (lowered as CapabilityStatus)
    : fallback;
}

function capabilityFromValue(
  key: string,
  value: unknown,
  fallback: CapabilityStatus,
): CompanyBrainCapability {
  if (typeof value === "boolean") {
    return {
      key,
      status: value ? "enabled" : "disabled",
      message: null,
      source: null,
    };
  }
  if (typeof value === "string") {
    return {
      key,
      status: normalizeCapabilityStatus(value, fallback),
      message: null,
      source: null,
    };
  }
  const record = jsonRecord(value);
  return {
    key,
    status: normalizeCapabilityStatus(record.status ?? record.state, fallback),
    message: stringValue(record.message),
    source: stringValue(record.source),
  };
}

function materializeCapabilities(
  knownKeys: readonly string[],
  rawValue: unknown,
  fallback: CapabilityStatus,
): CompanyBrainCapability[] {
  const raw = jsonRecord(rawValue);
  const seen = new Set<string>();
  const capabilities = knownKeys.map((key) => {
    seen.add(key);
    return capabilityFromValue(key, raw[key], fallback);
  });
  for (const key of Object.keys(raw).sort()) {
    if (seen.has(key)) continue;
    capabilities.push(capabilityFromValue(key, raw[key], fallback));
  }
  return capabilities;
}

function explicitCapabilities(row: BrainSubstrateStateRow) {
  return {
    launch: materializeCapabilities(
      LAUNCH_CAPABILITY_DEFAULTS,
      row.launch_capabilities,
      "unknown",
    ),
    optional: materializeCapabilities(
      OPTIONAL_CAPABILITY_DEFAULTS,
      row.optional_capabilities,
      "disabled",
    ),
  };
}

function legacyLaunchCapabilities(cognee: CogneeStatus): JsonRecord {
  const status: CapabilityStatus = cognee.enabled ? "degraded" : "disabled";
  const message = cognee.enabled
    ? "Legacy Cognee environment projection has no substrate smoke evidence."
    : "Cognee is not configured for this tenant.";
  return Object.fromEntries(
    LAUNCH_CAPABILITY_DEFAULTS.map((key) => [
      key,
      { status, message, source: "legacy_cognee_env" },
    ]),
  );
}

function emptyMigrationStatus() {
  return {
    id: null,
    phase: "none",
    status: "none",
    fromStorageTier: null,
    toStorageTier: null,
    requestedAt: null,
    startedAt: null,
    completedAt: null,
    rollbackWindowClosesAt: null,
    errorMessage: null,
    validationSummary: null,
  };
}

function migrationStatus(row: BrainSubstrateMigrationRow | null) {
  if (!row) return emptyMigrationStatus();
  return {
    id: row.id,
    phase: row.phase,
    status: row.status,
    fromStorageTier: row.from_storage_tier,
    toStorageTier: row.to_storage_tier,
    requestedAt: isoDate(row.requested_at),
    startedAt: isoDate(row.started_at),
    completedAt: isoDate(row.completed_at),
    rollbackWindowClosesAt: isoDate(row.rollback_window_closes_at),
    errorMessage: row.error_message,
    validationSummary: jsonScalar(row.validation_summary),
  };
}

function evidence(
  row: BrainSubstrateStateRow,
  migration: BrainSubstrateMigrationRow | null,
) {
  return {
    managedApplicationId: row.managed_application_id,
    latestDeploymentJobId: row.latest_deployment_job_id,
    backendMode: row.backend_mode,
    graphProvider: row.graph_provider,
    vectorProvider: row.vector_provider,
    embeddingModel: row.embedding_model,
    vectorDimension: row.vector_dimension,
    cogneeVersion: row.cognee_version,
    cogneeEndpoint: row.cognee_endpoint,
    s3ArtifactRoot: row.s3_artifact_root,
    s3ManifestRoot: row.s3_manifest_root,
    s3VaultProjectionRoot: row.s3_vault_projection_root,
    neptuneGraphId: row.neptune_graph_id,
    neptuneEndpoint: row.neptune_endpoint,
    efsFileSystemId: row.efs_file_system_id,
    productionPosture: row.production_posture,
    operatorEvidence: jsonScalar(row.operator_evidence),
    migrationEvidence: jsonScalar(migration?.operator_evidence),
  };
}

function legacyEvidence(cognee: CogneeStatus) {
  return {
    managedApplicationId: null,
    latestDeploymentJobId: null,
    backendMode: cognee.backendMode,
    graphProvider: null,
    vectorProvider: null,
    embeddingModel: null,
    vectorDimension: null,
    cogneeVersion: null,
    cogneeEndpoint: cognee.endpoint,
    s3ArtifactRoot: null,
    s3ManifestRoot: null,
    s3VaultProjectionRoot: null,
    neptuneGraphId: null,
    neptuneEndpoint: null,
    efsFileSystemId: null,
    productionPosture: "legacy_env_projection",
    operatorEvidence: JSON.stringify({ source: "legacy_cognee_env" }),
    migrationEvidence: null,
  };
}

function projectExplicitStatus(args: {
  tenantId: string;
  row: BrainSubstrateStateRow;
  migration: BrainSubstrateMigrationRow | null;
  includeEvidence: boolean;
}) {
  const { tenantId, row, migration, includeEvidence } = args;
  return {
    tenantId,
    storageTier: row.storage_tier,
    activeBackend: row.active_backend,
    status: row.status,
    healthStatus: row.health_status,
    counters: {
      ingestionQueueDepth: row.ingestion_queue_depth,
      failedIngestCount: row.failed_ingest_count,
      graphEntityCount: row.graph_entity_count,
      graphEdgeCount: row.graph_edge_count,
      sourceArtifactCount: row.source_artifact_count,
      vaultProjectionCount: row.vault_projection_count,
      latestIngestAt: isoDate(row.latest_ingest_at),
      latestProjectionAt: isoDate(row.latest_projection_at),
      ontologyVersion: row.ontology_version,
    },
    capabilities: explicitCapabilities(row),
    migration: migrationStatus(migration),
    evidence: includeEvidence ? evidence(row, migration) : null,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

function projectLegacyStatus(args: {
  tenantId: string;
  cognee: CogneeStatus;
  includeEvidence: boolean;
}) {
  const { tenantId, cognee, includeEvidence } = args;
  return {
    tenantId,
    storageTier: "default",
    activeBackend: cognee.enabled ? "legacy_cognee" : "none",
    status: cognee.enabled ? "ready" : "not_installed",
    healthStatus: cognee.enabled ? "degraded" : "unknown",
    counters: {
      ingestionQueueDepth: 0,
      failedIngestCount: 0,
      graphEntityCount: null,
      graphEdgeCount: null,
      sourceArtifactCount: null,
      vaultProjectionCount: null,
      latestIngestAt: null,
      latestProjectionAt: null,
      ontologyVersion: null,
    },
    capabilities: {
      launch: materializeCapabilities(
        LAUNCH_CAPABILITY_DEFAULTS,
        legacyLaunchCapabilities(cognee),
        cognee.enabled ? "degraded" : "disabled",
      ),
      optional: materializeCapabilities(
        OPTIONAL_CAPABILITY_DEFAULTS,
        {},
        "disabled",
      ),
    },
    migration: emptyMigrationStatus(),
    evidence: includeEvidence ? legacyEvidence(cognee) : null,
    createdAt: null,
    updatedAt: null,
  };
}

export const companyBrainStatus = async (
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
  deps: CompanyBrainStatusResolverDeps = createDrizzleCompanyBrainStatusDeps(),
) => {
  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) throw tenantContextError();

  const includeEvidence = await canViewOperatorEvidence(ctx, tenantId);
  if (!includeEvidence) {
    await requireTenantMember(ctx, tenantId);
  }

  const row = await deps.getSubstrateState(tenantId);
  if (row) {
    const migration = await deps.getLatestMigration({
      tenantId,
      substrateId: row.id,
    });
    return projectExplicitStatus({ tenantId, row, migration, includeEvidence });
  }

  return projectLegacyStatus({
    tenantId,
    cognee: deps.readLegacyCogneeStatus(),
    includeEvidence,
  });
};
