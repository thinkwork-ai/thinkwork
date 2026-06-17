import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import {
  requestCompanyBrainProductionMigration,
  updateCompanyBrainMigration,
  type BrainMigrationDeps,
  type BrainSubstrateMigrationRow,
} from "@thinkwork/plugin-company-brain/api/migration";

export const requestCompanyBrainProductionMigrationMutation = async (
  _parent: unknown,
  args: {
    input: {
      tenantId?: string | null;
      embeddingModel?: string | null;
      vectorDimension?: number | null;
      allowEmptySourceSet?: boolean | null;
      emptySourceReason?: string | null;
      operatorEvidence?: string | Record<string, unknown> | null;
    };
  },
  ctx: GraphQLContext,
  deps?: BrainMigrationDeps,
) => {
  const tenantId = await resolveBrainTenantId(ctx, args.input.tenantId);
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "company_brain_migration:request",
  );
  const migration = await requestCompanyBrainProductionMigration(
    {
      tenantId,
      requestedByUserId: await resolveOptionalCallerUserId(ctx),
      embeddingModel: args.input.embeddingModel,
      vectorDimension: args.input.vectorDimension,
      allowEmptySourceSet: args.input.allowEmptySourceSet,
      emptySourceReason: args.input.emptySourceReason,
      operatorEvidence: parseOptionalJsonRecord(args.input.operatorEvidence),
    },
    deps,
  );
  return toCompanyBrainMigrationStatus(migration);
};

export const updateCompanyBrainMigrationMutation = async (
  _parent: unknown,
  args: {
    input: {
      tenantId?: string | null;
      migrationId: string;
      phase: string;
      status?: string | null;
      validationSummary?: string | Record<string, unknown> | null;
      operatorEvidence?: string | Record<string, unknown> | null;
      errorMessage?: string | null;
      rollbackWindowClosesAt?: string | null;
    };
  },
  ctx: GraphQLContext,
  deps?: BrainMigrationDeps,
) => {
  const tenantId = await resolveBrainTenantId(ctx, args.input.tenantId);
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "company_brain_migration:update",
  );
  const migration = await updateCompanyBrainMigration(
    {
      tenantId,
      migrationId: args.input.migrationId,
      phase: normalizePhase(args.input.phase),
      status: args.input.status ? normalizeStatus(args.input.status) : null,
      validationSummary: parseOptionalJsonRecord(args.input.validationSummary),
      operatorEvidence: parseOptionalJsonRecord(args.input.operatorEvidence),
      errorMessage: args.input.errorMessage,
      rollbackWindowClosesAt: args.input.rollbackWindowClosesAt,
    },
    deps,
  );
  return toCompanyBrainMigrationStatus(migration);
};

async function resolveBrainTenantId(
  ctx: GraphQLContext,
  tenantIdInput: string | null | undefined,
): Promise<string> {
  const tenantId = tenantIdInput || (await resolveCallerTenantId(ctx));
  if (!tenantId) {
    throw forbidden("Tenant context required");
  }
  return tenantId;
}

async function resolveOptionalCallerUserId(
  ctx: GraphQLContext,
): Promise<string | null> {
  try {
    return await resolveCallerUserId(ctx);
  } catch {
    return null;
  }
}

function normalizePhase(value: string) {
  const phase = value.trim().toLowerCase();
  if (
    phase === "requested" ||
    phase === "snapshotting" ||
    phase === "provisioning" ||
    phase === "replaying" ||
    phase === "validating" ||
    phase === "cutover" ||
    phase === "completed" ||
    phase === "failed" ||
    phase === "rolled_back"
  ) {
    return phase;
  }
  throw badInput("Invalid Company Brain migration phase");
}

function normalizeStatus(value: string) {
  const status = value.trim().toLowerCase();
  if (
    status === "requested" ||
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "rolled_back" ||
    status === "canceled"
  ) {
    return status;
  }
  throw badInput("Invalid Company Brain migration status");
}

export function toCompanyBrainMigrationStatus(
  migration: BrainSubstrateMigrationRow,
) {
  return {
    id: migration.id,
    phase: migration.phase,
    status: migration.status,
    fromStorageTier: migration.from_storage_tier,
    toStorageTier: migration.to_storage_tier,
    requestedAt: isoDate(migration.requested_at),
    startedAt: isoDate(migration.started_at),
    completedAt: isoDate(migration.completed_at),
    rollbackWindowClosesAt: isoDate(migration.rollback_window_closes_at),
    errorMessage: migration.error_message,
    validationSummary: JSON.stringify(migration.validation_summary ?? {}),
  };
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function parseOptionalJsonRecord(
  value: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (value == null) return null;
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw badInput("Company Brain migration JSON fields must be valid JSON");
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw badInput("Company Brain migration JSON fields must be objects");
}

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}
