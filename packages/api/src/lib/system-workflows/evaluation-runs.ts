import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { systemWorkflowRuns } from "@thinkwork/database-pg/schema";
import { recordSystemWorkflowEvidence } from "./evidence.js";
import { recordSystemWorkflowStepEvent } from "./events.js";

export type EvalSystemWorkflowContext = {
  tenantId: string;
  runId: string;
  executionArn?: string | null;
};

export async function recordEvaluationWorkflowStep(
  context: EvalSystemWorkflowContext | null | undefined,
  input: {
    nodeId: string;
    stepType: string;
    status: string;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    inputJson?: unknown;
    outputJson?: unknown;
    errorJson?: unknown;
    idempotencyKey: string;
  },
): Promise<void> {
  if (!context?.runId || !context.tenantId) return;
  await recordSystemWorkflowStepEvent({
    tenantId: context.tenantId,
    runId: context.runId,
    nodeId: input.nodeId,
    stepType: input.stepType,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    inputJson: input.inputJson,
    outputJson: input.outputJson,
    errorJson: input.errorJson,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function recordEvaluationWorkflowEvidence(
  context: EvalSystemWorkflowContext | null | undefined,
  input: {
    evidenceType: string;
    title: string;
    summary?: string | null;
    artifactJson?: unknown;
    complianceTags?: string[];
    idempotencyKey: string;
  },
): Promise<void> {
  if (!context?.runId || !context.tenantId) return;
  await recordSystemWorkflowEvidence({
    tenantId: context.tenantId,
    runId: context.runId,
    evidenceType: input.evidenceType,
    title: input.title,
    summary: input.summary,
    artifactJson: input.artifactJson,
    complianceTags: input.complianceTags,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function updateEvaluationWorkflowRunSummary(
  context: EvalSystemWorkflowContext | null | undefined,
  summary: Record<string, unknown>,
): Promise<void> {
  if (!context?.runId) return;
  await getDb()
    .update(systemWorkflowRuns)
    .set({
      evidence_summary_json: summary,
      total_cost_usd_cents:
        typeof summary.totalCostUsdCents === "number"
          ? summary.totalCostUsdCents
          : null,
    })
    .where(eq(systemWorkflowRuns.id, context.runId));
}
