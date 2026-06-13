/**
 * GraphQL resolvers for eval datasets (Evaluations Trust Core U4).
 *
 * Datasets are S3-canonical versioned artifacts under
 * `tenants/<tenant-slug>/eval-datasets/<dataset-slug>/`; the eval_datasets
 * table is a derived write-through index (packages/api/src/lib/evals/
 * dataset-store.ts). Every mutation here:
 *
 *   1. gates with requireTenantAdmin BEFORE any side effect,
 *   2. derives the tenant slug from the tenants row (never caller input),
 *   3. writes S3 first, then re-syncs the full index state under a
 *      per-(tenant, slug) advisory lock inside dataset-store.
 *
 * Reads scope through resolveCallerTenantId (Google-federated callers have
 * null ctx.auth.tenantId) and fail closed. The single-dataset read drift-
 * checks the index manifest_sha against S3 and heals on mismatch.
 */

import { GraphQLError } from "graphql";
import { getConfig } from "@thinkwork/runtime-config";
import { S3Client } from "@aws-sdk/client-s3";
import type { GraphQLContext } from "../../context.js";
import { db, eq, and, isNull, desc, tenants } from "../../utils.js";
import { evalDatasets, evalTestCases } from "@thinkwork/database-pg/schema";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import {
  EVAL_DATASET_CASE_ID_RE,
  EVAL_DATASET_SLUG_RE,
  archiveEvalDataset as archiveDatasetInStore,
  createDrizzleDatasetIndexStore,
  createEvalDataset as createDatasetInStore,
  createS3DatasetStorage,
  getEvalDatasetCase,
  putEvalDatasetCase,
  readEvalDataset,
  removeEvalDatasetCase as removeCaseInStore,
  renameEvalDataset,
  type DatasetContext,
  type DatasetIndexStore,
  type DatasetStorage,
  type EvalDatasetCaseCore,
  type EvalDatasetCaseEngines,
  type EvalDatasetKind,
} from "../../../lib/evals/dataset-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read-path tenant scoping — mirrors resolveReadTenantId in ./index.ts. */
async function resolveReadTenantId(
  ctx: GraphQLContext,
): Promise<string | null> {
  return ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
}

export function badInput(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function assertSlugArg(value: string, label: string): void {
  if (!EVAL_DATASET_SLUG_RE.test(value)) {
    throw badInput(
      `Invalid ${label} "${value}": must start with a lowercase letter and contain only a-z, 0-9, and hyphens (max 64 chars).`,
    );
  }
}

/** Case ids get the longer budget (historical seed names run to 67 chars). */
function assertCaseIdArg(value: string): void {
  if (!EVAL_DATASET_CASE_ID_RE.test(value)) {
    throw badInput(
      `Invalid case id "${value}": must start with a lowercase letter and contain only a-z, 0-9, and hyphens (max 128 chars).`,
    );
  }
}

/**
 * Production wiring for the store interfaces. Factored so tests can mock
 * the dataset-store module wholesale; the resolver logic never touches
 * S3Client/Drizzle directly.
 */
export function datasetDeps(): {
  storage: DatasetStorage;
  store: DatasetIndexStore;
} {
  const bucket = getConfig("WORKSPACE_BUCKET");
  if (!bucket) {
    throw new GraphQLError("WORKSPACE_BUCKET not configured", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  const client = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return {
    storage: createS3DatasetStorage({ client, bucket }),
    store: createDrizzleDatasetIndexStore(),
  };
}

/** Tenant slug is always row-derived, never caller-supplied (U4 KTD). */
export async function loadTenantSlug(tenantId: string): Promise<string> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) {
    throw new GraphQLError("Tenant not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return tenant.slug;
}

export async function datasetContext(
  tenantId: string,
  slug: string,
): Promise<DatasetContext> {
  return { tenantId, tenantSlug: await loadTenantSlug(tenantId), slug };
}

export function datasetToGraphql(row: Record<string, unknown>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    version: row.version,
    manifestSha: row.manifest_sha ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function caseRowToGraphql(row: Record<string, unknown>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    category: row.category,
    query: row.query,
    systemPrompt: row.system_prompt,
    assertions: JSON.stringify(row.assertions ?? []),
    agentcoreEvaluatorIds: row.agentcore_evaluator_ids ?? [],
    tags: row.tags ?? [],
    enabled: row.enabled,
    source: row.source,
    datasetId: row.dataset_id ?? null,
    datasetCaseId: row.dataset_case_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadDatasetRow(
  tenantId: string,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select()
    .from(evalDatasets)
    .where(
      and(eq(evalDatasets.tenant_id, tenantId), eq(evalDatasets.slug, slug)),
    );
  return (row as Record<string, unknown> | undefined) ?? null;
}

export async function loadDatasetRowOrThrow(
  tenantId: string,
  slug: string,
): Promise<Record<string, unknown>> {
  const row = await loadDatasetRow(tenantId, slug);
  if (!row) {
    throw new GraphQLError(`Dataset ${slug} not found`, {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return row;
}

export async function loadCaseRowOrThrow(
  datasetId: string,
  caseId: string,
): Promise<Record<string, unknown>> {
  const [row] = await db
    .select()
    .from(evalTestCases)
    .where(
      and(
        eq(evalTestCases.dataset_id, datasetId),
        eq(evalTestCases.dataset_case_id, caseId),
      ),
    );
  if (!row) {
    throw new GraphQLError(`Case ${caseId} did not sync into the index`, {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
  return row as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const evalDatasetsQuery = async (
  _p: unknown,
  args: { tenantId: string; includeArchived?: boolean | null },
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId || tenantId !== args.tenantId) return [];
  const conditions = [eq(evalDatasets.tenant_id, tenantId)];
  // Soft-archived datasets hide from the default listing; their rows and
  // result history stay intact (and visible with includeArchived).
  if (!args.includeArchived) conditions.push(isNull(evalDatasets.archived_at));
  const rows = await db
    .select()
    .from(evalDatasets)
    .where(and(...conditions))
    .orderBy(desc(evalDatasets.created_at));
  return rows.map((r) => datasetToGraphql(r as Record<string, unknown>));
};

const evalDatasetQuery = async (
  _p: unknown,
  args: { tenantId: string; slug: string },
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId || tenantId !== args.tenantId) return null;
  // Reject malformed slugs before they reach an S3 key (read path fails
  // soft: null, no error chatter).
  if (!EVAL_DATASET_SLUG_RE.test(args.slug)) return null;

  // Drift detection on dataset read: compare the index row's manifest_sha
  // against S3 and re-sync on mismatch so a quiet tenant heals on access.
  const dctx = await datasetContext(tenantId, args.slug);
  const { storage, store } = datasetDeps();
  const read = await readEvalDataset(dctx, storage, store);
  if (!read) return null;

  const row = await loadDatasetRow(tenantId, args.slug);
  return row ? datasetToGraphql(row) : null;
};

// ---------------------------------------------------------------------------
// Mutations — S3 write first, then index sync (inside dataset-store)
// ---------------------------------------------------------------------------

interface CreateDatasetInput {
  slug: string;
  name?: string | null;
  kind?: string | null;
}

const createEvalDataset = async (
  _p: unknown,
  args: { tenantId: string; input: CreateDatasetInput },
  ctx: GraphQLContext,
) => {
  // Arg-derived gate — no row exists yet. Must precede every side effect.
  await requireTenantAdmin(ctx, args.tenantId);
  assertSlugArg(args.input.slug, "dataset slug");
  const kind: EvalDatasetKind =
    args.input.kind === "baseline" ? "baseline" : "custom";

  const dctx = await datasetContext(args.tenantId, args.input.slug);
  const { storage, store } = datasetDeps();
  try {
    await createDatasetInStore(
      dctx,
      { name: args.input.name ?? null, kind },
      storage,
      store,
    );
  } catch (err) {
    throw badInput(err instanceof Error ? err.message : String(err));
  }
  return datasetToGraphql(
    await loadDatasetRowOrThrow(args.tenantId, args.input.slug),
  );
};

const updateEvalDataset = async (
  _p: unknown,
  args: { tenantId: string; slug: string; input: { name?: string | null } },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  assertSlugArg(args.slug, "dataset slug");
  const dctx = await datasetContext(args.tenantId, args.slug);
  const { storage, store } = datasetDeps();
  await renameEvalDataset(dctx, args.input.name ?? null, storage, store);
  return datasetToGraphql(
    await loadDatasetRowOrThrow(args.tenantId, args.slug),
  );
};

const archiveEvalDataset = async (
  _p: unknown,
  args: { tenantId: string; slug: string },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  assertSlugArg(args.slug, "dataset slug");
  const dctx = await datasetContext(args.tenantId, args.slug);
  const { storage, store } = datasetDeps();
  // Soft archive (idempotent) — never a hard delete while runs/results
  // reference the dataset; history stays intact.
  await archiveDatasetInStore(dctx, storage, store);
  return datasetToGraphql(
    await loadDatasetRowOrThrow(args.tenantId, args.slug),
  );
};

interface DatasetCaseInput {
  caseId: string;
  name: string;
  category: string;
  query: string;
  systemPrompt?: string | null;
  expectedBehavior?: string | null;
  assertions?: Array<{
    type: string;
    value?: string | null;
    path?: string | null;
  }> | null;
  agentcoreEvaluatorIds?: string[] | null;
  tags?: string[] | null;
  enabled?: boolean | null;
}

/**
 * Engine-specific evaluator selections live only in the namespaced
 * `engines` extension block of the case file — the canonical core format
 * never references engine vocabulary (U4 KTD; U10 boundary test).
 */
function enginesBlockFromInput(
  agentcoreEvaluatorIds: string[] | null | undefined,
  previous: EvalDatasetCaseEngines | null,
): EvalDatasetCaseEngines | null {
  if (agentcoreEvaluatorIds === undefined) return previous;
  if (!agentcoreEvaluatorIds || agentcoreEvaluatorIds.length === 0) {
    // Strip the agentcore block but keep any other engine namespaces.
    const rest = { ...(previous ?? {}) };
    delete rest.agentcore;
    return Object.keys(rest).length > 0 ? rest : null;
  }
  return {
    ...(previous ?? {}),
    agentcore: { evaluator_ids: agentcoreEvaluatorIds },
  };
}

const addEvalDatasetCase = async (
  _p: unknown,
  args: { tenantId: string; datasetSlug: string; input: DatasetCaseInput },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  assertSlugArg(args.datasetSlug, "dataset slug");
  assertCaseIdArg(args.input.caseId);

  const dctx = await datasetContext(args.tenantId, args.datasetSlug);
  const { storage, store } = datasetDeps();

  const existing = await getEvalDatasetCase(dctx, args.input.caseId, storage);
  if (existing) {
    throw badInput(
      `Case ${args.input.caseId} already exists in dataset ${args.datasetSlug}.`,
    );
  }

  const core: EvalDatasetCaseCore = {
    case_id: args.input.caseId,
    name: args.input.name,
    category: args.input.category,
    query: args.input.query,
    system_prompt: args.input.systemPrompt ?? null,
    expected_behavior: args.input.expectedBehavior ?? null,
    assertions: args.input.assertions ?? [],
    tags: args.input.tags ?? [],
    enabled: args.input.enabled ?? true,
  };
  const engines = enginesBlockFromInput(args.input.agentcoreEvaluatorIds, null);
  await putEvalDatasetCase(dctx, core, engines, storage, store);

  const dataset = await loadDatasetRowOrThrow(args.tenantId, args.datasetSlug);
  return caseRowToGraphql(
    await loadCaseRowOrThrow(String(dataset.id), args.input.caseId),
  );
};

interface UpdateDatasetCaseInput {
  name?: string | null;
  category?: string | null;
  query?: string | null;
  systemPrompt?: string | null;
  expectedBehavior?: string | null;
  assertions?: Array<{
    type: string;
    value?: string | null;
    path?: string | null;
  }> | null;
  agentcoreEvaluatorIds?: string[] | null;
  tags?: string[] | null;
  enabled?: boolean | null;
}

const updateEvalDatasetCase = async (
  _p: unknown,
  args: {
    tenantId: string;
    datasetSlug: string;
    caseId: string;
    input: UpdateDatasetCaseInput;
  },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  assertSlugArg(args.datasetSlug, "dataset slug");
  assertCaseIdArg(args.caseId);

  const dctx = await datasetContext(args.tenantId, args.datasetSlug);
  const { storage, store } = datasetDeps();

  const existing = await getEvalDatasetCase(dctx, args.caseId, storage);
  if (!existing) {
    throw new GraphQLError(
      `Case ${args.caseId} not found in dataset ${args.datasetSlug}`,
      { extensions: { code: "NOT_FOUND" } },
    );
  }

  const core: EvalDatasetCaseCore = {
    ...existing.core,
    name: args.input.name ?? existing.core.name,
    category: args.input.category ?? existing.core.category,
    query: args.input.query ?? existing.core.query,
    system_prompt:
      args.input.systemPrompt !== undefined
        ? args.input.systemPrompt
        : existing.core.system_prompt,
    expected_behavior:
      args.input.expectedBehavior !== undefined
        ? args.input.expectedBehavior
        : existing.core.expected_behavior,
    assertions: args.input.assertions ?? existing.core.assertions,
    tags: args.input.tags ?? existing.core.tags,
    enabled: args.input.enabled ?? existing.core.enabled,
  };
  const engines = enginesBlockFromInput(
    args.input.agentcoreEvaluatorIds,
    existing.engines,
  );
  await putEvalDatasetCase(dctx, core, engines, storage, store);

  const dataset = await loadDatasetRowOrThrow(args.tenantId, args.datasetSlug);
  return caseRowToGraphql(
    await loadCaseRowOrThrow(String(dataset.id), args.caseId),
  );
};

const removeEvalDatasetCase = async (
  _p: unknown,
  args: { tenantId: string; datasetSlug: string; caseId: string },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  assertSlugArg(args.datasetSlug, "dataset slug");
  assertCaseIdArg(args.caseId);

  const dctx = await datasetContext(args.tenantId, args.datasetSlug);
  const { storage, store } = datasetDeps();
  // Case removal = manifest tombstone + enabled=false on the index row
  // (never a row delete — historical eval_results FK the case); the S3
  // payload object is deleted inside the store.
  try {
    await removeCaseInStore(dctx, args.caseId, storage, store);
  } catch (err) {
    throw new GraphQLError(err instanceof Error ? err.message : String(err), {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return datasetToGraphql(
    await loadDatasetRowOrThrow(args.tenantId, args.datasetSlug),
  );
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const evalDatasetQueries = {
  evalDatasets: evalDatasetsQuery,
  evalDataset: evalDatasetQuery,
};

export const evalDatasetMutations = {
  createEvalDataset,
  updateEvalDataset,
  archiveEvalDataset,
  addEvalDatasetCase,
  updateEvalDatasetCase,
  removeEvalDatasetCase,
};
