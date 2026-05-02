/**
 * GraphQL resolvers for the Evaluations feature (port from maniflow).
 *
 * v1: queries + mutations + a fire-and-forget invocation of the eval-runner
 * Lambda from `startEvalRun`. The live System Workflow adapter now routes
 * new runs through a Standard Step Functions parent, which invokes
 * eval-runner while preserving the GraphQL contract. Subscription wiring
 * lives in subscriptions.graphql; the eval-runner Lambda calls
 * notifyEvalRunUpdate via AppSync after each state change.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, and, desc, sql } from "../../utils.js";
import {
  evalRuns,
  evalResults,
  evalTestCases,
  agents,
  agentTemplates,
} from "@thinkwork/database-pg/schema";
import { startSystemWorkflow } from "../../../lib/system-workflows/start.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Convert PG row → GraphQL camelCase. Drizzle returns snake_case columns;
// GraphQL schema uses camelCase. Keep this surgical (not a generic util).
function runToGraphql(
  row: Record<string, unknown>,
  agentName?: string | null,
  agentTemplateName?: string | null,
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    agentName: agentName ?? null,
    agentTemplateId: row.agent_template_id ?? null,
    agentTemplateName: agentTemplateName ?? null,
    status: row.status,
    model: row.model,
    categories: row.categories,
    totalTests: row.total_tests,
    passed: row.passed,
    failed: row.failed,
    passRate: row.pass_rate ? Number(row.pass_rate) : null,
    regression: row.regression,
    costUsd: row.cost_usd ? Number(row.cost_usd) : null,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function resultToGraphql(
  row: Record<string, unknown>,
  testCase?: { name: string; category: string } | null,
) {
  return {
    id: row.id,
    runId: row.run_id,
    testCaseId: row.test_case_id,
    testCaseName: testCase?.name ?? null,
    category: testCase?.category ?? null,
    status: row.status,
    score: row.score ? Number(row.score) : null,
    durationMs: row.duration_ms,
    agentSessionId: row.agent_session_id,
    input: row.input,
    expected: row.expected,
    actualOutput: row.actual_output,
    evaluatorResults: JSON.stringify(row.evaluator_results ?? []),
    assertions: JSON.stringify(row.assertions ?? []),
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function testCaseToGraphql(
  row: Record<string, unknown>,
  agentTemplateName?: string | null,
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    category: row.category,
    query: row.query,
    systemPrompt: row.system_prompt,
    agentTemplateId: row.agent_template_id ?? null,
    agentTemplateName: agentTemplateName ?? null,
    assertions: JSON.stringify(row.assertions ?? []),
    agentcoreEvaluatorIds: row.agentcore_evaluator_ids ?? [],
    tags: row.tags ?? [],
    enabled: row.enabled,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const evalSummary = async (
  _p: any,
  args: { tenantId: string },
  _ctx: GraphQLContext,
) => {
  const [agg] = await db
    .select({
      totalRuns: sql<number>`COUNT(*)::int`,
      latestPassRate: sql<
        number | null
      >`(SELECT pass_rate::float FROM eval_runs WHERE tenant_id = ${args.tenantId} AND status = 'completed' ORDER BY completed_at DESC LIMIT 1)`,
      avgPassRate: sql<number | null>`AVG(pass_rate)::float`,
      regressionCount: sql<number>`COUNT(*) FILTER (WHERE regression = true)::int`,
    })
    .from(evalRuns)
    .where(eq(evalRuns.tenant_id, args.tenantId));
  return {
    totalRuns: agg?.totalRuns ?? 0,
    latestPassRate: agg?.latestPassRate ?? null,
    avgPassRate: agg?.avgPassRate ?? null,
    regressionCount: agg?.regressionCount ?? 0,
  };
};

const evalRunsQuery = async (
  _p: any,
  args: {
    tenantId: string;
    agentId?: string | null;
    limit?: number | null;
    offset?: number | null;
  },
  _ctx: GraphQLContext,
) => {
  const limit = Math.min(args.limit ?? 25, 100);
  const offset = args.offset ?? 0;
  const conditions = [eq(evalRuns.tenant_id, args.tenantId)];
  if (args.agentId) conditions.push(eq(evalRuns.agent_id, args.agentId));
  const where = and(...conditions);

  const [{ totalCount }] = await db
    .select({ totalCount: sql<number>`COUNT(*)::int` })
    .from(evalRuns)
    .where(where);

  const rows = await db
    .select({
      run: evalRuns,
      agentName: agents.name,
      agentTemplateName: agentTemplates.name,
    })
    .from(evalRuns)
    .leftJoin(agents, eq(evalRuns.agent_id, agents.id))
    .leftJoin(agentTemplates, eq(evalRuns.agent_template_id, agentTemplates.id))
    .where(where)
    .orderBy(desc(evalRuns.created_at))
    .limit(limit)
    .offset(offset);

  return {
    items: rows.map((r) =>
      runToGraphql(
        r.run as unknown as Record<string, unknown>,
        r.agentName,
        r.agentTemplateName,
      ),
    ),
    totalCount,
  };
};

const evalRun = async (_p: any, args: { id: string }, _ctx: GraphQLContext) => {
  const [row] = await db
    .select({
      run: evalRuns,
      agentName: agents.name,
      agentTemplateName: agentTemplates.name,
    })
    .from(evalRuns)
    .leftJoin(agents, eq(evalRuns.agent_id, agents.id))
    .leftJoin(agentTemplates, eq(evalRuns.agent_template_id, agentTemplates.id))
    .where(eq(evalRuns.id, args.id));
  if (!row) return null;
  return runToGraphql(
    row.run as unknown as Record<string, unknown>,
    row.agentName,
    row.agentTemplateName,
  );
};

const evalRunResults = async (
  _p: any,
  args: { runId: string },
  _ctx: GraphQLContext,
) => {
  const rows = await db
    .select({
      result: evalResults,
      testCaseName: evalTestCases.name,
      testCaseCategory: evalTestCases.category,
    })
    .from(evalResults)
    .leftJoin(evalTestCases, eq(evalResults.test_case_id, evalTestCases.id))
    .where(eq(evalResults.run_id, args.runId))
    .orderBy(desc(evalResults.created_at));
  return rows.map((r) =>
    resultToGraphql(
      r.result as unknown as Record<string, unknown>,
      r.testCaseName
        ? { name: r.testCaseName, category: r.testCaseCategory ?? "" }
        : null,
    ),
  );
};

const evalTimeSeries = async (
  _p: any,
  args: { tenantId: string; days?: number | null },
  _ctx: GraphQLContext,
) => {
  const days = args.days ?? 30;
  const points = await db.execute(sql`
		SELECT
			TO_CHAR(date_trunc('day', completed_at), 'YYYY-MM-DD') AS day,
			AVG(pass_rate)::float AS pass_rate,
			COUNT(*)::int AS run_count,
			SUM(passed)::int AS passed,
			SUM(failed)::int AS failed
		FROM eval_runs
		WHERE tenant_id = ${args.tenantId}
		  AND status = 'completed'
		  AND completed_at >= NOW() - (${days} || ' days')::interval
		GROUP BY 1
		ORDER BY 1 ASC
	`);
  const rows = (points as unknown as { rows?: any[] }).rows ?? [];
  return rows.map((r: any) => ({
    day: r.day,
    passRate: r.pass_rate,
    runCount: r.run_count,
    passed: r.passed,
    failed: r.failed,
  }));
};

const evalTestCasesQuery = async (
  _p: any,
  args: { tenantId: string; category?: string | null; search?: string | null },
  _ctx: GraphQLContext,
) => {
  // Auto-seed the maniflow starter pack on first visit. We check for the
  // presence of ANY yaml-seed row for this tenant — if zero, run the seed.
  // The partial unique index makes this idempotent on the off-chance two
  // concurrent first-visit queries race. Seeded rows then show up
  // immediately in the same response.
  await ensureTenantSeeded(args.tenantId);

  const conditions = [eq(evalTestCases.tenant_id, args.tenantId)];
  if (args.category) conditions.push(eq(evalTestCases.category, args.category));
  if (args.search)
    conditions.push(
      sql`${evalTestCases.name} ILIKE ${"%" + args.search + "%"}`,
    );
  const rows = await db
    .select({ tc: evalTestCases, agentTemplateName: agentTemplates.name })
    .from(evalTestCases)
    .leftJoin(
      agentTemplates,
      eq(evalTestCases.agent_template_id, agentTemplates.id),
    )
    .where(and(...conditions))
    .orderBy(desc(evalTestCases.updated_at));
  return rows.map((r) =>
    testCaseToGraphql(
      r.tc as unknown as Record<string, unknown>,
      r.agentTemplateName,
    ),
  );
};

/**
 * Lazy-seed the maniflow starter pack on a tenant's first visit to the
 * Studio. Cached in-memory per Lambda container so subsequent queries
 * for the same tenant skip the COUNT(*) probe.
 */
const _seededTenants = new Set<string>();
async function ensureTenantSeeded(tenantId: string): Promise<void> {
  if (_seededTenants.has(tenantId)) return;
  const [{ count }] = await db
    .select({
      count: sql<number>`COUNT(*) FILTER (WHERE source = 'yaml-seed')::int`,
    })
    .from(evalTestCases)
    .where(eq(evalTestCases.tenant_id, tenantId));
  if (count > 0) {
    _seededTenants.add(tenantId);
    return;
  }
  const { EVAL_SEEDS } = await import("../../../lib/eval-seeds.js");
  if (EVAL_SEEDS.length === 0) {
    _seededTenants.add(tenantId);
    return;
  }
  await db
    .insert(evalTestCases)
    .values(
      EVAL_SEEDS.map((s) => ({
        tenant_id: tenantId,
        name: s.name,
        category: s.category,
        query: s.query,
        assertions: s.assertions,
        source: "yaml-seed" as const,
        agentcore_evaluator_ids: ["Builtin.Helpfulness"],
      })),
    )
    .onConflictDoNothing();
  _seededTenants.add(tenantId);
}

const evalTestCase = async (
  _p: any,
  args: { id: string },
  _ctx: GraphQLContext,
) => {
  const [row] = await db
    .select({ tc: evalTestCases, agentTemplateName: agentTemplates.name })
    .from(evalTestCases)
    .leftJoin(
      agentTemplates,
      eq(evalTestCases.agent_template_id, agentTemplates.id),
    )
    .where(eq(evalTestCases.id, args.id));
  return row
    ? testCaseToGraphql(
        row.tc as unknown as Record<string, unknown>,
        row.agentTemplateName,
      )
    : null;
};

const evalTestCaseHistory = async (
  _p: any,
  args: { testCaseId: string; limit?: number | null },
  _ctx: GraphQLContext,
) => {
  const limit = Math.min(args.limit ?? 20, 100);
  const rows = await db
    .select({ result: evalResults })
    .from(evalResults)
    .where(eq(evalResults.test_case_id, args.testCaseId))
    .orderBy(desc(evalResults.created_at))
    .limit(limit);
  return rows.map((r) =>
    resultToGraphql(r.result as unknown as Record<string, unknown>, null),
  );
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

interface StartEvalRunInput {
  agentId?: string | null;
  agentTemplateId?: string | null;
  model?: string | null;
  categories?: string[] | null;
  testCaseIds?: string[] | null;
}

const startEvalRun = async (
  _p: any,
  args: { tenantId: string; input: StartEvalRunInput },
  _ctx: GraphQLContext,
) => {
  const [run] = await db
    .insert(evalRuns)
    .values({
      tenant_id: args.tenantId,
      agent_id: args.input.agentId ?? null,
      agent_template_id: args.input.agentTemplateId ?? null,
      status: "pending",
      model: args.input.model ?? null,
      categories: args.input.categories ?? [],
    })
    .returning();

  try {
    await startSystemWorkflow({
      workflowId: "evaluation-runs",
      tenantId: args.tenantId,
      triggerSource: "graphql",
      actorId: _ctx.auth.principalId ?? null,
      actorType: _ctx.auth.authType,
      domainRef: { type: "eval_run", id: (run as { id: string }).id },
      input: {
        evalRunId: (run as { id: string }).id,
        agentId: args.input.agentId ?? null,
        agentTemplateId: args.input.agentTemplateId ?? null,
        model: args.input.model ?? null,
        categories: args.input.categories ?? [],
        testCaseIds: args.input.testCaseIds ?? [],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(evalRuns)
      .set({
        status: "failed",
        completed_at: new Date(),
        error_message: message,
      })
      .where(eq(evalRuns.id, (run as { id: string }).id));
    throw err;
  }

  return runToGraphql(run as unknown as Record<string, unknown>, null);
};

const cancelEvalRun = async (
  _p: any,
  args: { id: string },
  _ctx: GraphQLContext,
) => {
  const [row] = await db
    .update(evalRuns)
    .set({ status: "cancelled", completed_at: new Date() })
    .where(eq(evalRuns.id, args.id))
    .returning();
  if (!row) throw new Error(`run ${args.id} not found`);
  return runToGraphql(row as unknown as Record<string, unknown>, null);
};

const deleteEvalRun = async (
  _p: any,
  args: { id: string },
  _ctx: GraphQLContext,
) => {
  await db.delete(evalRuns).where(eq(evalRuns.id, args.id));
  return true;
};

interface CreateTestCaseInput {
  name: string;
  category: string;
  query: string;
  systemPrompt?: string | null;
  agentTemplateId?: string | null;
  assertions?: Array<{
    type: string;
    value?: string | null;
    path?: string | null;
  }> | null;
  agentcoreEvaluatorIds?: string[] | null;
  tags?: string[] | null;
  enabled?: boolean | null;
}

const createEvalTestCase = async (
  _p: any,
  args: { tenantId: string; input: CreateTestCaseInput },
  _ctx: GraphQLContext,
) => {
  const [row] = await db
    .insert(evalTestCases)
    .values({
      tenant_id: args.tenantId,
      name: args.input.name,
      category: args.input.category,
      query: args.input.query,
      system_prompt: args.input.systemPrompt ?? null,
      agent_template_id: args.input.agentTemplateId ?? null,
      assertions: args.input.assertions ?? [],
      agentcore_evaluator_ids: args.input.agentcoreEvaluatorIds ?? [],
      tags: args.input.tags ?? [],
      enabled: args.input.enabled ?? true,
    })
    .returning();
  return testCaseToGraphql(row as unknown as Record<string, unknown>);
};

interface UpdateTestCaseInput extends Partial<CreateTestCaseInput> {}

const updateEvalTestCase = async (
  _p: any,
  args: { id: string; input: UpdateTestCaseInput },
  _ctx: GraphQLContext,
) => {
  const update: Record<string, unknown> = { updated_at: new Date() };
  if (args.input.name !== undefined) update.name = args.input.name;
  if (args.input.category !== undefined) update.category = args.input.category;
  if (args.input.query !== undefined) update.query = args.input.query;
  if (args.input.systemPrompt !== undefined)
    update.system_prompt = args.input.systemPrompt;
  if (args.input.agentTemplateId !== undefined)
    update.agent_template_id = args.input.agentTemplateId;
  if (args.input.assertions !== undefined)
    update.assertions = args.input.assertions;
  if (args.input.agentcoreEvaluatorIds !== undefined)
    update.agentcore_evaluator_ids = args.input.agentcoreEvaluatorIds;
  if (args.input.tags !== undefined) update.tags = args.input.tags;
  if (args.input.enabled !== undefined) update.enabled = args.input.enabled;
  const [row] = await db
    .update(evalTestCases)
    .set(update)
    .where(eq(evalTestCases.id, args.id))
    .returning();
  if (!row) throw new Error(`test case ${args.id} not found`);
  return testCaseToGraphql(row as unknown as Record<string, unknown>);
};

const deleteEvalTestCase = async (
  _p: any,
  args: { id: string },
  _ctx: GraphQLContext,
) => {
  await db.delete(evalTestCases).where(eq(evalTestCases.id, args.id));
  return true;
};

const seedEvalTestCases = async (
  _p: any,
  args: { tenantId: string; categories?: string[] | null },
  _ctx: GraphQLContext,
) => {
  const { EVAL_SEEDS } = await import("../../../lib/eval-seeds.js");
  const filtered =
    args.categories && args.categories.length > 0
      ? EVAL_SEEDS.filter((s) => args.categories!.includes(s.category))
      : EVAL_SEEDS;
  if (filtered.length === 0) return 0;

  // Idempotent insert. We deliberately skip on (tenant_id, name)
  // conflict — the partial unique index added in migration 0011 enforces
  // this only for source='yaml-seed' rows so user-created tests with
  // the same name are unaffected.
  const values = filtered.map((s) => ({
    tenant_id: args.tenantId,
    name: s.name,
    category: s.category,
    query: s.query,
    assertions: s.assertions,
    source: "yaml-seed" as const,
    // Default Helpfulness evaluator on every seeded test — gives the
    // user a working scoring loop out of the box.
    agentcore_evaluator_ids: ["Builtin.Helpfulness"],
  }));
  // onConflictDoNothing() with no `target` triggers Postgres's generic
  // "any unique violation" handling, which catches the partial index
  // uq_eval_test_cases_tenant_seed_name without needing to spell out the
  // WHERE clause (drizzle doesn't support partial-index ON CONFLICT).
  const inserted = await db
    .insert(evalTestCases)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: evalTestCases.id });
  return inserted.length;
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const evaluationsQueries = {
  evalSummary,
  evalRuns: evalRunsQuery,
  evalRun,
  evalRunResults,
  evalTimeSeries,
  evalTestCases: evalTestCasesQuery,
  evalTestCase,
  evalTestCaseHistory,
};

export const evaluationsMutations = {
  startEvalRun,
  cancelEvalRun,
  deleteEvalRun,
  createEvalTestCase,
  updateEvalTestCase,
  deleteEvalTestCase,
  seedEvalTestCases,
};
