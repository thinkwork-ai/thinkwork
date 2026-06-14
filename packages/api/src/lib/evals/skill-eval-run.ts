/**
 * Skill-eval run launcher + score read (Skill Tests & Evals U5).
 *
 * Install/reinstall of a skill now SURFACES the skill's eval score: U2
 * seeds the per-skill dataset, and this module fires the async scored run
 * (the Phase-C seam goes live) and exposes the latest score + regression
 * for the UI (U9) to read via GraphQL.
 *
 * `launchSkillEvalRun` mirrors `startEvalRun`'s dataset launch path but is
 * SELF-GUARDING and NEVER THROWS — its callers are defensive install/
 * reinstall handlers that must never break the install over an eval
 * hiccup. It resolves the per-skill dataset, refuses to launch when the
 * skill is unrated (no manifest / zero enabled cases), validates the
 * default eval model against the tenant catalog, inserts the pending run,
 * claims the eval-baseline agent under the per-tenant lock (busy → run
 * marked failed, status "busy"), and fires the eval-runner Lambda
 * asynchronously (Event invoke), exactly like `invokeEvalRunner` — the
 * Event-invoke is replicated LOCALLY here to avoid an import cycle back
 * into the evaluations resolver.
 *
 * `readSkillEvalScore` projects the latest two completed scored runs of
 * the per-skill dataset into a regression-aware score the UI renders.
 * Regression is "latest pass rate < previous pass rate" across the two
 * most recent completed runs of the CURRENT scoring version — a baseline
 * change or scoring-version bump never reads as a skill regression
 * because those runs carry a different scoring_version and are excluded.
 */

import {
  db,
  and,
  eq,
  desc,
  sql,
  evalDatasets,
  evalTestCases,
} from "../../graphql/utils.js";
import { evalRuns } from "@thinkwork/database-pg/schema";
import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";
import { DEFAULT_EVAL_MODEL_ID } from "./eval-defaults.js";
import { skillEvalDatasetSlug } from "./skill-dataset.js";
import { resolveDatasetForLaunch } from "./run-launch.js";
import {
  claimEvalBaselineForRun,
  EvalBaselineBusyError,
} from "./eval-baseline-agent.js";
import { getTenantModelCatalogEntry } from "../model-catalog/tenant-catalog.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SkillEvalLaunchResult =
  | { status: "launched"; runId: string }
  | { status: "unrated" }
  | { status: "busy" }
  | { status: "skipped"; reason: string };

export interface SkillEvalScore {
  skillSlug: string;
  datasetSlug: string;
  /** True once the dataset carries at least one enabled case. */
  rated: boolean;
  /** Latest completed scored run's pass rate (0.0–1.0); null when unrated/no score. */
  passRate: number | null;
  /** Latest completed run scored below the previous completed run. */
  regression: boolean;
  lastRunId: string | null;
  lastRunAt: string | null;
  totalCases: number;
}

// ---------------------------------------------------------------------------
// Local Event-invoke of the eval-runner Lambda
//
// Replicated from evaluations/index.ts `invokeEvalRunner` rather than
// imported — importing the resolver here would create a cycle (the
// resolver imports this module's siblings). Same fn-name resolution and
// Event InvocationType as the resolver path.
// ---------------------------------------------------------------------------

function evalRunnerFnName(): string | null {
  return (
    process.env.EVAL_RUNNER_FN ??
    (process.env.STAGE
      ? `thinkwork-${process.env.STAGE}-api-eval-runner`
      : null)
  );
}

async function invokeEvalRunnerAsync(runId: string): Promise<void> {
  const fnName = evalRunnerFnName();
  if (!fnName) {
    throw new Error("EVAL_RUNNER_FN not configured");
  }
  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  await lambda.send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(JSON.stringify({ runId })),
    }),
  );
}

/** Mark a just-inserted run failed (defensive paths use this, never throw). */
async function markRunFailed(runId: string, message: string): Promise<void> {
  await db
    .update(evalRuns)
    .set({
      status: "failed",
      completed_at: new Date(),
      error_message: message,
    })
    .where(eq(evalRuns.id, runId));
}

// ---------------------------------------------------------------------------
// launchSkillEvalRun — fire the async scored run for a skill (self-guarding)
// ---------------------------------------------------------------------------

export async function launchSkillEvalRun(args: {
  tenantId: string;
  skillSlug: string;
}): Promise<SkillEvalLaunchResult> {
  const { tenantId, skillSlug } = args;
  const datasetSlug = skillEvalDatasetSlug(skillSlug);

  // 1. Resolve the dataset. No manifest (skill never seeded cases) →
  //    unrated, never an error (R3).
  let datasetId: string;
  try {
    datasetId = (await resolveDatasetForLaunch(tenantId, datasetSlug)).id;
  } catch {
    return { status: "unrated" };
  }

  // 2. Count enabled cases — a dataset with zero enabled cases is unrated.
  const [{ enabledCount }] = await db
    .select({ enabledCount: sql<number>`COUNT(*)::int` })
    .from(evalTestCases)
    .where(
      and(
        eq(evalTestCases.dataset_id, datasetId),
        eq(evalTestCases.enabled, true),
      ),
    );
  if ((enabledCount ?? 0) === 0) {
    return { status: "unrated" };
  }

  // 3. Resolve the model — the default eval model must be enabled in the
  //    tenant catalog or the run can't be scored.
  const model = DEFAULT_EVAL_MODEL_ID;
  const catalogRow = await getTenantModelCatalogEntry({
    tenantId,
    modelId: model,
  });
  if (!catalogRow) {
    return {
      status: "skipped",
      reason: "default eval model not enabled in tenant catalog",
    };
  }

  // 4. Insert the pending run row (agent assigned by the baseline claim).
  const [run] = await db
    .insert(evalRuns)
    .values({
      tenant_id: tenantId,
      agent_id: null,
      status: "pending",
      execution_target: "agentcore",
      runtime_host: "aws-agentcore",
      model,
      dataset_id: datasetId,
      // Scoring semantics stamped at creation — never inferred later.
      scoring_version: CURRENT_EVAL_SCORING_VERSION,
    })
    .returning({ id: evalRuns.id });
  const runId = run.id;

  // 5. Claim the eval-baseline agent under the per-tenant lock. A run
  //    already in flight → busy (run marked failed so the runs list shows
  //    the recoverable trail); any other failure → skipped with the
  //    message. Never throws — callers are defensive.
  try {
    await claimEvalBaselineForRun({ tenantId, skillSlug, runId });
  } catch (err) {
    if (err instanceof EvalBaselineBusyError) {
      await markRunFailed(runId, err.message);
      return { status: "busy" };
    }
    const message = err instanceof Error ? err.message : String(err);
    await markRunFailed(runId, message);
    return { status: "skipped", reason: message };
  }

  // 6. Fire the runner async (Event invoke). An unconfigured runner or an
  //    invoke failure marks the run failed and reports skipped.
  try {
    await invokeEvalRunnerAsync(runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markRunFailed(runId, message);
    return { status: "skipped", reason: message };
  }

  return { status: "launched", runId };
}

// ---------------------------------------------------------------------------
// readSkillEvalScore — latest score + regression for the UI (U9)
// ---------------------------------------------------------------------------

export async function readSkillEvalScore(
  tenantId: string,
  skillSlug: string,
): Promise<SkillEvalScore> {
  const datasetSlug = skillEvalDatasetSlug(skillSlug);

  const unrated = (): SkillEvalScore => ({
    skillSlug,
    datasetSlug,
    rated: false,
    passRate: null,
    regression: false,
    lastRunId: null,
    lastRunAt: null,
    totalCases: 0,
  });

  // No dataset row → unrated. (Tenant scoping is the caller's gate.)
  const [dataset] = await db
    .select({ id: evalDatasets.id })
    .from(evalDatasets)
    .where(
      and(
        eq(evalDatasets.tenant_id, tenantId),
        eq(evalDatasets.slug, datasetSlug),
      ),
    )
    .limit(1);
  if (!dataset) return unrated();

  const [{ totalCases }] = await db
    .select({ totalCases: sql<number>`COUNT(*)::int` })
    .from(evalTestCases)
    .where(
      and(
        eq(evalTestCases.dataset_id, dataset.id),
        eq(evalTestCases.enabled, true),
      ),
    );
  const rated = (totalCases ?? 0) > 0;

  // Latest two completed scored runs (current scoring version only — a
  // baseline/version change carries a different scoring_version and is
  // excluded so it never reads as a skill regression).
  const recent = await db
    .select({
      id: evalRuns.id,
      passRate: evalRuns.pass_rate,
      completedAt: evalRuns.completed_at,
    })
    .from(evalRuns)
    .where(
      and(
        eq(evalRuns.tenant_id, tenantId),
        eq(evalRuns.dataset_id, dataset.id),
        eq(evalRuns.status, "completed"),
        eq(evalRuns.scoring_version, CURRENT_EVAL_SCORING_VERSION),
      ),
    )
    .orderBy(desc(evalRuns.completed_at))
    .limit(2);

  const latest = recent[0] ?? null;
  const prev = recent[1] ?? null;
  const latestPassRate =
    latest?.passRate != null ? Number(latest.passRate) : null;
  const prevPassRate = prev?.passRate != null ? Number(prev.passRate) : null;
  const regression =
    latestPassRate != null && prevPassRate != null
      ? latestPassRate < prevPassRate
      : false;

  return {
    skillSlug,
    datasetSlug,
    rated,
    passRate: latestPassRate,
    regression,
    lastRunId: latest?.id ?? null,
    lastRunAt: latest?.completedAt ? latest.completedAt.toISOString() : null,
    totalCases: totalCases ?? 0,
  };
}
