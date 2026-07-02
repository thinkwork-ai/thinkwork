/**
 * GraphQL resolvers for Eval Profiles (THINK-107 U2).
 *
 * Thin boundary layer: operator gating (requireTenantAdmin) BEFORE any
 * side effect, tenant scoping through resolveCallerTenantId on reads,
 * model-catalog validation at the edge — lifecycle invariants (single
 * default, archive guard, get-or-create) live in
 * packages/api/src/lib/evals/eval-profiles.ts.
 *
 * The agent-under-test `model` validates against the tenant model catalog
 * (same gate as startEvalRun's resolveEvalModelId). The judge pin is NOT
 * tenant-catalog gated: judges are platform-scoped scoring models (the
 * deployed default is a Haiku-class model that tenant catalogs typically
 * don't enable for agents), so we accept a trimmed non-empty id and let
 * the scoring engine surface invocation errors loudly.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { getTenantModelCatalogEntry } from "../../../lib/model-catalog/tenant-catalog.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import {
  EvalProfileError,
  archiveEvalProfile as archiveProfileInLib,
  createEvalProfile as createProfileInLib,
  duplicateEvalProfile as duplicateProfileInLib,
  getEvalProfile,
  listEvalProfiles,
  setDefaultEvalProfile as setDefaultProfileInLib,
  updateEvalProfile as updateProfileInLib,
  type EvalProfileRow,
} from "../../../lib/evals/eval-profiles.js";

function toGraphQLError(err: unknown): unknown {
  if (err instanceof EvalProfileError) {
    return new GraphQLError(err.message, {
      extensions: { code: err.code },
    });
  }
  return err;
}

function renderProfile(row: EvalProfileRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    model: row.model,
    judgeModel: row.judge_model,
    trials: row.trials,
    isDefault: row.is_default,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function assertAgentModelEnabled(
  tenantId: string,
  model: string,
): Promise<string> {
  const requested = model.trim();
  if (!requested) {
    throw new GraphQLError("Profile model must be non-empty.", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const catalogRow = await getTenantModelCatalogEntry({
    tenantId,
    modelId: requested,
  });
  if (!catalogRow) {
    throw new GraphQLError(
      `Eval model ${requested} is not enabled in the tenant model catalog.`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
  return requested;
}

function normalizeJudgeModel(
  judgeModel: string | null | undefined,
): string | null {
  const trimmed = judgeModel?.trim();
  return trimmed ? trimmed : null;
}

/** Load a profile row and gate the caller as an admin of its tenant. */
async function requireProfileAdmin(
  ctx: GraphQLContext,
  id: string,
): Promise<EvalProfileRow> {
  const row = await getEvalProfile(id);
  if (!row) {
    throw new GraphQLError("Profile not found.", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantAdmin(ctx, row.tenant_id);
  return row;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const evalProfilesQuery = async (
  _p: unknown,
  args: { tenantId: string; includeArchived?: boolean | null },
  ctx: GraphQLContext,
) => {
  const tenantId = ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId || tenantId !== args.tenantId) return [];
  const rows = await listEvalProfiles(
    args.tenantId,
    args.includeArchived ?? false,
  );
  return rows.map(renderProfile);
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const createEvalProfile = async (
  _p: unknown,
  args: {
    tenantId: string;
    input: {
      name: string;
      model: string;
      judgeModel?: string | null;
      trials?: number | null;
    };
  },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  const model = await assertAgentModelEnabled(args.tenantId, args.input.model);
  try {
    const row = await createProfileInLib({
      tenantId: args.tenantId,
      name: args.input.name,
      model,
      judgeModel: normalizeJudgeModel(args.input.judgeModel),
      trials: args.input.trials ?? null,
    });
    return renderProfile(row);
  } catch (err) {
    throw toGraphQLError(err);
  }
};

const updateEvalProfile = async (
  _p: unknown,
  args: {
    id: string;
    input: {
      name?: string | null;
      model?: string | null;
      judgeModel?: string | null;
      clearJudgeModel?: boolean | null;
      trials?: number | null;
    };
  },
  ctx: GraphQLContext,
) => {
  const existing = await requireProfileAdmin(ctx, args.id);
  const model =
    args.input.model != null
      ? await assertAgentModelEnabled(existing.tenant_id, args.input.model)
      : null;
  try {
    const row = await updateProfileInLib(args.id, {
      name: args.input.name ?? null,
      model,
      judgeModel: normalizeJudgeModel(args.input.judgeModel),
      clearJudgeModel: args.input.clearJudgeModel ?? null,
      trials: args.input.trials ?? null,
    });
    return renderProfile(row);
  } catch (err) {
    throw toGraphQLError(err);
  }
};

const duplicateEvalProfile = async (
  _p: unknown,
  args: { id: string; name?: string | null },
  ctx: GraphQLContext,
) => {
  await requireProfileAdmin(ctx, args.id);
  try {
    const row = await duplicateProfileInLib(args.id, args.name ?? null);
    return renderProfile(row);
  } catch (err) {
    throw toGraphQLError(err);
  }
};

const archiveEvalProfile = async (
  _p: unknown,
  args: { id: string },
  ctx: GraphQLContext,
) => {
  await requireProfileAdmin(ctx, args.id);
  try {
    const row = await archiveProfileInLib(args.id);
    return renderProfile(row);
  } catch (err) {
    throw toGraphQLError(err);
  }
};

const setDefaultEvalProfile = async (
  _p: unknown,
  args: { id: string },
  ctx: GraphQLContext,
) => {
  await requireProfileAdmin(ctx, args.id);
  try {
    const row = await setDefaultProfileInLib(args.id);
    return renderProfile(row);
  } catch (err) {
    throw toGraphQLError(err);
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const evalProfileQueries = {
  evalProfiles: evalProfilesQuery,
};

export const evalProfileMutations = {
  createEvalProfile,
  updateEvalProfile,
  duplicateEvalProfile,
  archiveEvalProfile,
  setDefaultEvalProfile,
};
