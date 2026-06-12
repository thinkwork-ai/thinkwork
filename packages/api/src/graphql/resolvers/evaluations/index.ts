/**
 * GraphQL resolvers for the Evaluations feature (port from maniflow).
 *
 * v1: queries + mutations + a fire-and-forget invocation of the eval-runner
 * Lambda from `startEvalRun`. Subscription wiring lives in
 * subscriptions.graphql; the eval-runner Lambda calls notifyEvalRunUpdate
 * via AppSync after each state change.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, and, asc, desc, inArray, sql } from "../../utils.js";
import {
  evalRuns,
  evalResults,
  evalTestCases,
  agents,
  threadTurns,
} from "@thinkwork/database-pg/schema";
import {
  fetchSpansForSession,
  type AgentCoreSpanRecord,
} from "../../../lib/agentcore-spans.js";
import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";
import { DEFAULT_EVAL_MODEL_ID } from "../../../lib/evals/agentcore-direct.js";
import { resolveTenantPlatformAgent } from "../../../lib/agents/tenant-platform-agent.js";
import { getTenantModelCatalogEntry } from "../../../lib/model-catalog/tenant-catalog.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the caller's tenant for read-path scoping. `ctx.auth.tenantId`
 * is null for Google-federated users until the Cognito pre-token trigger
 * lands, so fall back to the DB-backed resolver
 * (docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md).
 * Returns null when no tenant resolves; callers must fail closed
 * (empty/null result, no side effects).
 */
async function resolveReadTenantId(
  ctx: GraphQLContext,
): Promise<string | null> {
  return ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
}

// Convert PG row → GraphQL camelCase. Drizzle returns snake_case columns;
// GraphQL schema uses camelCase. Keep this surgical (not a generic util).
function runToGraphql(row: Record<string, unknown>, agentName?: string | null) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    agentName: agentName ?? null,
    computerId: row.computer_id ?? null,
    scheduledJobId: row.scheduled_job_id ?? null,
    status: row.status,
    executionTarget: row.execution_target ?? "agentcore",
    runtimeHost: row.runtime_host ?? "aws-agentcore",
    model: row.model,
    categories: row.categories,
    selectedTestCaseIds: row.selected_test_case_ids ?? [],
    totalTests: row.total_tests,
    passed: row.passed,
    failed: row.failed,
    errored: row.errored ?? null,
    // Legacy runs predate scoring_version stamping: errors were folded
    // into `failed` and pass_rate used the old denominator. Surface the
    // label so UIs never blend the two scales silently.
    scoringVersion: row.scoring_version ?? null,
    isLegacyScoring: row.scoring_version == null,
    passRate: row.pass_rate ? Number(row.pass_rate) : null,
    regression: row.regression,
    costUsd: row.cost_usd ? Number(row.cost_usd) : null,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

type EvalRunProgress = {
  runId: string;
  completed: number;
  passed: number;
  /** Count of status='fail' rows only — errors are tallied separately. */
  failed: number;
  errored: number;
};

function progressOverlay(
  row: Record<string, unknown>,
  progress: EvalRunProgress,
): Record<string, unknown> {
  if (row.scoring_version == null) {
    // Legacy semantics: errors fold into `failed`, old denominator.
    return {
      ...row,
      passed: progress.passed,
      failed: progress.completed - progress.passed,
      pass_rate: (progress.passed / progress.completed).toFixed(4),
    };
  }

  const scoreable = progress.passed + progress.failed;
  return {
    ...row,
    passed: progress.passed,
    failed: progress.failed,
    errored: progress.errored,
    // No clean scoreable execution yet (or ever) → "no score", not 0%.
    pass_rate: scoreable > 0 ? (progress.passed / scoreable).toFixed(4) : null,
  };
}

export function withLiveProgress(
  row: Record<string, unknown>,
  progress: EvalRunProgress | undefined,
): Record<string, unknown> {
  const status = String(row.status ?? "");
  if (["pending", "running"].includes(status) && progress?.completed) {
    return progressOverlay(row, progress);
  }

  // Deploy-window guard: a run stamped with the current scoring version
  // but finalized by an old warm worker carries a divergent (null/stale)
  // summary_scoring_version. Re-present its summary under the stamped
  // semantics; the reconciler persists the correction.
  if (
    status === "completed" &&
    row.scoring_version === CURRENT_EVAL_SCORING_VERSION &&
    row.summary_scoring_version !== row.scoring_version &&
    progress
  ) {
    return progressOverlay(row, progress);
  }

  return row;
}

async function loadEvalRunProgress(
  runIds: string[],
): Promise<Map<string, EvalRunProgress>> {
  if (runIds.length === 0) return new Map();
  const rows = await db
    .select({
      runId: evalResults.run_id,
      completed: sql<number>`COUNT(*)::int`,
      passed: sql<number>`COUNT(*) FILTER (WHERE ${evalResults.status} = 'pass')::int`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${evalResults.status} = 'fail')::int`,
      errored: sql<number>`COUNT(*) FILTER (WHERE ${evalResults.status} = 'error')::int`,
    })
    .from(evalResults)
    .where(inArray(evalResults.run_id, runIds))
    .groupBy(evalResults.run_id);

  return new Map(
    rows.map((row) => [
      row.runId,
      {
        runId: row.runId,
        completed: Number(row.completed),
        passed: Number(row.passed),
        failed: Number(row.failed),
        errored: Number(row.errored),
      },
    ]),
  );
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
    threadTurnId: row.thread_turn_id ?? null,
    input: row.input,
    expected: row.expected,
    actualOutput: row.actual_output,
    systemPrompt: row.system_prompt ?? null,
    evaluatorResults: JSON.stringify(row.evaluator_results ?? []),
    assertions: JSON.stringify(row.assertions ?? []),
    errorMessage: row.error_message,
    errorCause: row.error_cause ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Field resolvers for EvalResult (plan 2026-06-12-002 U10).
 *
 * `workspaceProjection` lazily reads the linked turn's STORED
 * `context_snapshot.workspace_projection` — only when the field is selected,
 * so list queries pay nothing. The join goes through the parent run's tenant
 * so an eval result can never surface another tenant's turn snapshot.
 */
export const evalResultTypeResolvers = {
  workspaceProjection: async (parent: {
    threadTurnId?: string | null;
    runId?: string | null;
  }): Promise<string | null> => {
    if (!parent.threadTurnId || !parent.runId) return null;
    const rows = await db
      .select({ context_snapshot: threadTurns.context_snapshot })
      .from(threadTurns)
      .innerJoin(
        evalRuns,
        and(
          eq(evalRuns.id, parent.runId),
          eq(evalRuns.tenant_id, threadTurns.tenant_id),
        ),
      )
      .where(eq(threadTurns.id, parent.threadTurnId))
      .limit(1);
    const snapshot = rows[0]?.context_snapshot as Record<
      string,
      unknown
    > | null;
    const projection = snapshot?.workspace_projection;
    if (projection === undefined || projection === null) return null;
    return JSON.stringify(projection);
  },
};

export function placeholderStatusForEvalRun(runStatus: string) {
  if (runStatus === "pending") return "pending";
  if (runStatus === "running") return "running";
  return "waiting";
}

export function shouldIncludePlannedEvalRows(runStatus: string): boolean {
  return runStatus === "pending" || runStatus === "running";
}

export function excludesComputerSurfacePlaceholders(
  run: Pick<typeof evalRuns.$inferSelect, "computer_id" | "execution_target">,
): boolean {
  return run.execution_target !== "desktop-pi" && !run.computer_id;
}

function plannedResultToGraphql(
  run: Record<string, unknown>,
  testCase: {
    id: string;
    name: string;
    category: string;
    query: string;
    assertions: unknown;
  },
) {
  return {
    id: `pending:${run.id}:${testCase.id}`,
    runId: run.id,
    testCaseId: testCase.id,
    testCaseName: testCase.name,
    category: testCase.category,
    status: placeholderStatusForEvalRun(String(run.status ?? "")),
    score: null,
    durationMs: null,
    agentSessionId: null,
    threadTurnId: null,
    input: testCase.query,
    expected: null,
    actualOutput: null,
    systemPrompt: null,
    evaluatorResults: JSON.stringify([]),
    assertions: JSON.stringify(testCase.assertions ?? []),
    errorMessage: null,
    errorCause: null,
    createdAt: run.created_at,
  };
}

export function spanToGraphql(row: AgentCoreSpanRecord) {
  const timestampMs = spanTimestampMs(row);
  const attributes = isRecord(row.attributes) ? row.attributes : row;
  return {
    timestamp: timestampMs ? new Date(timestampMs).toISOString() : null,
    name: spanName(row),
    attributes: JSON.stringify(attributes),
  };
}

function spanName(row: AgentCoreSpanRecord): string {
  for (const key of ["name", "spanName", "span_name"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "unknown span";
}

function spanTimestampMs(row: AgentCoreSpanRecord): number | null {
  for (const key of [
    "timestamp",
    "cloudWatchTimestamp",
    "startTime",
    "start_time",
    "startTimeUnixNano",
  ]) {
    const value = row[key];
    const parsed = parseTimestampMs(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000_000 ? Math.floor(value / 1_000_000) : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return parseTimestampMs(numeric);
    const dateMs = Date.parse(value);
    return Number.isFinite(dateMs) ? dateMs : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function testCaseToGraphql(row: Record<string, unknown>) {
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
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId || tenantId !== args.tenantId) {
    return {
      totalRuns: 0,
      latestPassRate: null,
      avgPassRate: null,
      regressionCount: 0,
    };
  }
  // Headline numbers never blend denominators: latest/avg pass rates
  // only aggregate non-cancelled completed runs stamped with the current
  // scoring version. Legacy runs (null scoring_version) used a different
  // denominator (errors counted as failed) and are excluded; AVG ignores
  // null pass_rate (all-error / zero-case runs) by construction.
  const [agg] = await db
    .select({
      totalRuns: sql<number>`COUNT(*)::int`,
      latestPassRate: sql<
        number | null
      >`(SELECT pass_rate::float FROM eval_runs WHERE tenant_id = ${tenantId} AND status = 'completed' AND scoring_version = ${CURRENT_EVAL_SCORING_VERSION} ORDER BY completed_at DESC LIMIT 1)`,
      avgPassRate: sql<
        number | null
      >`(AVG(pass_rate) FILTER (WHERE status = 'completed' AND scoring_version = ${CURRENT_EVAL_SCORING_VERSION}))::float`,
      regressionCount: sql<number>`COUNT(*) FILTER (WHERE regression = true)::int`,
    })
    .from(evalRuns)
    .where(eq(evalRuns.tenant_id, tenantId));
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
    limit?: number | null;
    offset?: number | null;
  },
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId || tenantId !== args.tenantId) {
    return { items: [], totalCount: 0 };
  }
  const limit = Math.min(args.limit ?? 25, 100);
  const offset = args.offset ?? 0;
  const where = eq(evalRuns.tenant_id, tenantId);

  const [{ totalCount }] = await db
    .select({ totalCount: sql<number>`COUNT(*)::int` })
    .from(evalRuns)
    .where(where);

  const rows = await db
    .select({
      run: evalRuns,
      agentName: agents.name,
    })
    .from(evalRuns)
    .leftJoin(agents, eq(evalRuns.agent_id, agents.id))
    .where(where)
    .orderBy(desc(evalRuns.created_at))
    .limit(limit)
    .offset(offset);

  const progressByRunId = await loadEvalRunProgress(rows.map((r) => r.run.id));

  return {
    items: rows.map((r) =>
      runToGraphql(
        withLiveProgress(
          r.run as unknown as Record<string, unknown>,
          progressByRunId.get(r.run.id),
        ),
        r.agentName,
      ),
    ),
    totalCount,
  };
};

const evalRun = async (_p: any, args: { id: string }, ctx: GraphQLContext) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId) return null;
  const [row] = await db
    .select({
      run: evalRuns,
      agentName: agents.name,
    })
    .from(evalRuns)
    .leftJoin(agents, eq(evalRuns.agent_id, agents.id))
    .where(and(eq(evalRuns.id, args.id), eq(evalRuns.tenant_id, tenantId)));
  if (!row) return null;
  const progressByRunId = await loadEvalRunProgress([args.id]);
  return runToGraphql(
    withLiveProgress(
      row.run as unknown as Record<string, unknown>,
      progressByRunId.get(args.id),
    ),
    row.agentName,
  );
};

const evalRunResults = async (
  _p: any,
  args: { runId: string },
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId) return [];
  const [run] = await db
    .select()
    .from(evalRuns)
    .where(and(eq(evalRuns.id, args.runId), eq(evalRuns.tenant_id, tenantId)));
  if (!run) return [];

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
  const actualRows = rows.map((r) =>
    resultToGraphql(
      r.result as unknown as Record<string, unknown>,
      r.testCaseName
        ? { name: r.testCaseName, category: r.testCaseCategory ?? "" }
        : null,
    ),
  );

  const actualByTestCaseId = new Map(
    actualRows
      .filter((result) => result.testCaseId)
      .map((result) => [result.testCaseId, result]),
  );
  const caseConditions = [
    eq(evalTestCases.tenant_id, run.tenant_id),
    eq(evalTestCases.enabled, true),
  ];
  if (run.selected_test_case_ids.length > 0) {
    caseConditions.push(inArray(evalTestCases.id, run.selected_test_case_ids));
  } else if (run.categories.length > 0) {
    caseConditions.push(inArray(evalTestCases.category, run.categories));
  }
  if (excludesComputerSurfacePlaceholders(run)) {
    caseConditions.push(
      sql`not (${evalTestCases.tags} @> ARRAY['surface:computer']::text[])`,
    );
  }

  const testCases = await db
    .select({
      id: evalTestCases.id,
      name: evalTestCases.name,
      category: evalTestCases.category,
      query: evalTestCases.query,
      assertions: evalTestCases.assertions,
    })
    .from(evalTestCases)
    .where(and(...caseConditions))
    .orderBy(asc(evalTestCases.category), asc(evalTestCases.name));

  const shouldIncludePlaceholders = shouldIncludePlannedEvalRows(run.status);
  const plannedTestCaseIds = new Set(testCases.map((testCase) => testCase.id));
  const plannedRows = testCases.flatMap((testCase) => {
    const actual = actualByTestCaseId.get(testCase.id);
    if (actual) return [actual];
    return shouldIncludePlaceholders
      ? [plannedResultToGraphql(run, testCase)]
      : [];
  });
  const resultRowsWithoutTestCase = actualRows.filter(
    (result) => !result.testCaseId,
  );
  const actualRowsOutsidePlannedSet = actualRows.filter(
    (result) =>
      typeof result.testCaseId === "string" &&
      !plannedTestCaseIds.has(result.testCaseId),
  );

  return [
    ...resultRowsWithoutTestCase,
    ...actualRowsOutsidePlannedSet,
    ...plannedRows,
  ];
};

export const evalResultSpans = async (
  _p: any,
  args: { runId: string; testCaseId: string },
  ctx: GraphQLContext,
) => {
  // The resolver row lookup is the only tenant boundary here — the
  // downstream CloudWatch span fetch has no tenant dimension. Refuse to
  // resolve a session id (and never issue the fetch) unless the run
  // belongs to the caller's tenant.
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId) return [];
  const [run] = await db
    .select({ id: evalRuns.id })
    .from(evalRuns)
    .where(and(eq(evalRuns.id, args.runId), eq(evalRuns.tenant_id, tenantId)));
  if (!run) return [];

  const [row] = await db
    .select({ agentSessionId: evalResults.agent_session_id })
    .from(evalResults)
    .where(
      and(
        eq(evalResults.run_id, args.runId),
        eq(evalResults.test_case_id, args.testCaseId),
      ),
    )
    .orderBy(desc(evalResults.created_at))
    .limit(1);

  if (!row?.agentSessionId) return [];

  try {
    const runtimeLogGroup = process.env.EVAL_TRACE_RUNTIME_LOG_GROUP || null;
    const spans = await fetchSpansForSession(row.agentSessionId, {
      runtimeLogGroup,
    });
    return spans.map(spanToGraphql).sort((a, b) => {
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return Date.parse(a.timestamp) - Date.parse(b.timestamp);
    });
  } catch (err) {
    console.warn("[evalResultSpans] unable to load trace spans", {
      runId: args.runId,
      testCaseId: args.testCaseId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
};

const evalTimeSeries = async (
  _p: any,
  args: { tenantId: string; days?: number | null },
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId || tenantId !== args.tenantId) return [];
  const days = args.days ?? 30;
  const points = await db.execute(sql`
		SELECT
			TO_CHAR(date_trunc('day', completed_at), 'YYYY-MM-DD') AS day,
			AVG(pass_rate)::float AS pass_rate,
			COUNT(*)::int AS run_count,
			SUM(passed)::int AS passed,
			SUM(failed)::int AS failed
		FROM eval_runs
		WHERE tenant_id = ${tenantId}
		  AND status = 'completed'
		  AND scoring_version = ${CURRENT_EVAL_SCORING_VERSION}
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
  ctx: GraphQLContext,
) => {
  // Seeding is a write triggered by a read — never let it land in a
  // foreign tenant. Resolve the caller's tenant first and refuse (empty
  // result, no seed) on mismatch.
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId || tenantId !== args.tenantId) return [];

  // Auto-seed the Thinkwork starter pack on first visit. We check for the
  // presence of ANY yaml-seed row for this tenant — if zero, run the seed.
  // The partial unique index makes this idempotent on the off-chance two
  // concurrent first-visit queries race. Seeded rows then show up
  // immediately in the same response.
  await ensureTenantSeeded(tenantId);

  const conditions = [eq(evalTestCases.tenant_id, tenantId)];
  if (args.category) conditions.push(eq(evalTestCases.category, args.category));
  if (args.search)
    conditions.push(
      sql`${evalTestCases.name} ILIKE ${"%" + args.search + "%"}`,
    );
  const rows = await db
    .select({ tc: evalTestCases })
    .from(evalTestCases)
    .where(and(...conditions))
    .orderBy(desc(evalTestCases.updated_at));
  return rows.map((r) =>
    testCaseToGraphql(r.tc as unknown as Record<string, unknown>),
  );
};

/**
 * Lazy-seed the Thinkwork starter pack on a tenant's first visit to the
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
  const { BUILT_IN_EVAL_SEED_SOURCE, EVAL_SEEDS } =
    await import("../../../lib/eval-seeds.js");
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
        source: BUILT_IN_EVAL_SEED_SOURCE,
        tags: seedTags(s),
        agentcore_evaluator_ids:
          s.agentcore_evaluator_ids && s.agentcore_evaluator_ids.length > 0
            ? s.agentcore_evaluator_ids
            : ["Builtin.Helpfulness"],
      })),
    )
    .onConflictDoNothing();
  _seededTenants.add(tenantId);
}

const evalTestCase = async (
  _p: any,
  args: { id: string },
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId) return null;
  const [row] = await db
    .select({ tc: evalTestCases })
    .from(evalTestCases)
    .where(
      and(eq(evalTestCases.id, args.id), eq(evalTestCases.tenant_id, tenantId)),
    );
  return row
    ? testCaseToGraphql(row.tc as unknown as Record<string, unknown>)
    : null;
};

const evalTestCaseHistory = async (
  _p: any,
  args: { testCaseId: string; limit?: number | null },
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveReadTenantId(ctx);
  if (!tenantId) return [];
  const [testCase] = await db
    .select({ id: evalTestCases.id })
    .from(evalTestCases)
    .where(
      and(
        eq(evalTestCases.id, args.testCaseId),
        eq(evalTestCases.tenant_id, tenantId),
      ),
    );
  if (!testCase) return [];
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
  computerId?: string | null;
  model?: string | null;
  categories?: string[] | null;
  testCaseIds?: string[] | null;
}

async function resolveEvalModelId(
  tenantId: string,
  inputModel: string | null | undefined,
) {
  const requested = inputModel?.trim() || DEFAULT_EVAL_MODEL_ID;
  const catalogRow = await getTenantModelCatalogEntry({
    tenantId,
    modelId: requested,
  });
  if (!catalogRow) {
    throw new Error(
      `Eval model ${requested} is not enabled in the tenant model catalog.`,
    );
  }

  return requested;
}

async function resolveRunTarget(args: {
  tenantId: string;
}): Promise<{ agentId: string }> {
  const platformAgent = await resolveTenantPlatformAgent(args.tenantId);
  return { agentId: platformAgent.id };
}

const startEvalRun = async (
  _p: any,
  args: { tenantId: string; input: StartEvalRunInput },
  ctx: GraphQLContext,
) => {
  // Gate before ANY side effect — a denied caller must leave zero rows
  // and never reach the model-catalog probe (arg-derived: no row yet).
  await requireTenantAdmin(ctx, args.tenantId);

  if (args.input.computerId) {
    throw new Error(
      "Computer eval targets are no longer supported. Evals run directly against AgentCore Agents.",
    );
  }

  const model = await resolveEvalModelId(args.tenantId, args.input.model);

  // Insert a pending row up front so the failure path (e.g. tenant has no
  // platform agent yet) still surfaces in the runs list with a recoverable
  // error_message. Plan R6 mandates the failed-row trail.
  const [run] = await db
    .insert(evalRuns)
    .values({
      tenant_id: args.tenantId,
      agent_id: null,
      computer_id: null,
      status: "pending",
      execution_target: "agentcore",
      runtime_host: "aws-agentcore",
      model,
      categories: args.input.categories ?? [],
      selected_test_case_ids: args.input.testCaseIds ?? [],
      // Scoring semantics are stamped at run creation — never inferred
      // later — so post-deploy code can't silently upgrade older runs.
      scoring_version: CURRENT_EVAL_SCORING_VERSION,
    })
    .returning();
  const runId = (run as { id: string }).id;

  let targetAgentId: string;
  try {
    const target = await resolveRunTarget({ tenantId: args.tenantId });
    targetAgentId = target.agentId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(evalRuns)
      .set({
        status: "failed",
        completed_at: new Date(),
        error_message: message,
      })
      .where(eq(evalRuns.id, runId));
    throw err;
  }

  const [withAgent] = await db
    .update(evalRuns)
    .set({ agent_id: targetAgentId })
    .where(eq(evalRuns.id, runId))
    .returning();

  try {
    await invokeEvalRunner(runId, args.input.testCaseIds ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(evalRuns)
      .set({
        status: "failed",
        completed_at: new Date(),
        error_message: message,
      })
      .where(eq(evalRuns.id, runId));
    throw err;
  }

  return runToGraphql(
    (withAgent ?? run) as unknown as Record<string, unknown>,
    null,
  );
};

async function invokeEvalRunner(
  runId: string,
  testCaseIds: string[] | null,
): Promise<void> {
  const fnName =
    process.env.EVAL_RUNNER_FN ??
    (process.env.STAGE
      ? `thinkwork-${process.env.STAGE}-api-eval-runner`
      : null);
  if (!fnName) {
    throw new Error(
      "EVAL_RUNNER_FN is not configured (set EVAL_RUNNER_FN or STAGE).",
    );
  }
  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  const payload: { runId: string; input?: { testCaseIds: string[] } } = {
    runId,
  };
  if (testCaseIds && testCaseIds.length > 0) {
    payload.input = { testCaseIds };
  }
  await lambda.send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );
}

const cancelEvalRun = async (
  _p: any,
  args: { id: string },
  ctx: GraphQLContext,
) => {
  const [existing] = await db
    .select({ tenantId: evalRuns.tenant_id })
    .from(evalRuns)
    .where(eq(evalRuns.id, args.id));
  if (!existing) throw new Error(`run ${args.id} not found`);
  // Row-derived gate — fails FORBIDDEN before the status write when the
  // run belongs to another tenant.
  await requireTenantAdmin(ctx, existing.tenantId);
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
  ctx: GraphQLContext,
) => {
  const [existing] = await db
    .select({ tenantId: evalRuns.tenant_id })
    .from(evalRuns)
    .where(eq(evalRuns.id, args.id));
  // Deleting a missing row stays an idempotent no-op (prior behavior).
  if (!existing) return true;
  await requireTenantAdmin(ctx, existing.tenantId);
  await db.delete(evalRuns).where(eq(evalRuns.id, args.id));
  return true;
};

interface CreateTestCaseInput {
  name: string;
  category: string;
  query: string;
  systemPrompt?: string | null;
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
  ctx: GraphQLContext,
) => {
  // Arg-derived gate — no row exists yet.
  await requireTenantAdmin(ctx, args.tenantId);
  const [row] = await db
    .insert(evalTestCases)
    .values({
      tenant_id: args.tenantId,
      name: args.input.name,
      category: args.input.category,
      query: args.input.query,
      system_prompt: args.input.systemPrompt ?? null,
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
  ctx: GraphQLContext,
) => {
  const [existing] = await db
    .select({ tenantId: evalTestCases.tenant_id })
    .from(evalTestCases)
    .where(eq(evalTestCases.id, args.id));
  if (!existing) throw new Error(`test case ${args.id} not found`);
  await requireTenantAdmin(ctx, existing.tenantId);
  const update: Record<string, unknown> = { updated_at: new Date() };
  if (args.input.name !== undefined) update.name = args.input.name;
  if (args.input.category !== undefined) update.category = args.input.category;
  if (args.input.query !== undefined) update.query = args.input.query;
  if (args.input.systemPrompt !== undefined)
    update.system_prompt = args.input.systemPrompt;
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
  ctx: GraphQLContext,
) => {
  const [existing] = await db
    .select({ tenantId: evalTestCases.tenant_id })
    .from(evalTestCases)
    .where(eq(evalTestCases.id, args.id));
  // Deleting a missing row stays an idempotent no-op (prior behavior).
  if (!existing) return true;
  await requireTenantAdmin(ctx, existing.tenantId);
  await db.delete(evalTestCases).where(eq(evalTestCases.id, args.id));
  return true;
};

const seedEvalTestCases = async (
  _p: any,
  args: { tenantId: string; categories?: string[] | null },
  ctx: GraphQLContext,
) => {
  // Arg-derived gate — seeding writes rows into the named tenant.
  await requireTenantAdmin(ctx, args.tenantId);
  const { BUILT_IN_EVAL_SEED_SOURCE, EVAL_SEEDS } =
    await import("../../../lib/eval-seeds.js");
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
    source: BUILT_IN_EVAL_SEED_SOURCE,
    tags: seedTags(s),
    agentcore_evaluator_ids:
      s.agentcore_evaluator_ids && s.agentcore_evaluator_ids.length > 0
        ? s.agentcore_evaluator_ids
        : ["Builtin.Helpfulness"],
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

function seedTags(seed: {
  target_surface?: string;
  target_skill?: string;
  threshold?: number;
}) {
  return [
    seed.target_surface ? `surface:${seed.target_surface}` : null,
    seed.target_skill ? `skill:${seed.target_skill}` : null,
    typeof seed.threshold === "number" ? `threshold:${seed.threshold}` : null,
  ].filter((tag): tag is string => Boolean(tag));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const evaluationsQueries = {
  evalSummary,
  evalRuns: evalRunsQuery,
  evalRun,
  evalRunResults,
  evalResultSpans,
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
