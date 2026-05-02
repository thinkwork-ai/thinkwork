import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  activationApplyOutbox,
  activationSessions,
} from "@thinkwork/database-pg/schema";
import {
  recordActivationWorkflowEvidence,
  recordActivationWorkflowStep,
  updateActivationWorkflowRunSummary,
  type ActivationSystemWorkflowContext,
} from "../lib/system-workflows/activation.js";

const db = getDb();

type ActivationWorkflowAdapterEvent = {
  activationSessionId?: string;
  tenantId?: string;
  userId?: string;
  mode?: string | null;
  focusLayer?: string | null;
  currentLayer?: string | null;
  policy?: Record<string, unknown> | null;
  systemWorkflowRunId?: string;
  systemWorkflowExecutionArn?: string | null;
};

type ActivationWorkflowAdapterResult = {
  ok: boolean;
  sessionId?: string;
  status?: string;
  launchReady?: boolean;
  error?: string;
  summary?: Record<string, unknown>;
};

const EXPECTED_STATUSES = new Set([
  "in_progress",
  "ready_for_review",
  "applied",
]);

export async function handler(
  event: ActivationWorkflowAdapterEvent,
): Promise<ActivationWorkflowAdapterResult> {
  const context = workflowContext(event);
  const sessionId = event.activationSessionId;
  if (!sessionId || !event.tenantId) {
    return fail(context, sessionId ?? "unknown", "activationSessionId and tenantId are required");
  }

  const [session] = await db
    .select()
    .from(activationSessions)
    .where(eq(activationSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return fail(context, sessionId, "Activation session not found");
  }
  if (session.tenant_id !== event.tenantId) {
    return fail(context, sessionId, "Tenant mismatch for activation session");
  }
  if (event.userId && session.user_id !== event.userId) {
    return fail(context, sessionId, "User mismatch for activation session");
  }
  if (!EXPECTED_STATUSES.has(session.status)) {
    return fail(
      context,
      sessionId,
      `Unsupported activation session status: ${session.status}`,
    );
  }

  const outboxRows = await db
    .select()
    .from(activationApplyOutbox)
    .where(eq(activationApplyOutbox.session_id, sessionId));
  const summary = activationSummary(session, outboxRows, event.policy ?? {});
  const launchReady = session.status === "ready_for_review" || session.status === "applied";
  const now = new Date();

  await recordActivationWorkflowStep(context, {
    nodeId: "TrackReadiness",
    stepType: "checkpoint",
    status: "succeeded",
    startedAt: now,
    finishedAt: now,
    outputJson: {
      sessionId,
      status: session.status,
      completedLayers: summary.completedLayerCount,
      currentLayer: session.current_layer,
    },
    idempotencyKey: `activation:${sessionId}:readiness`,
  });

  await recordActivationWorkflowStep(context, {
    nodeId: "RunPolicyChecks",
    stepType: "validation",
    status: "succeeded",
    startedAt: now,
    finishedAt: now,
    inputJson: { policy: event.policy ?? {} },
    outputJson: {
      securityAttestationRequired:
        event.policy?.securityAttestationRequired ?? true,
      launchApprovalRole: event.policy?.launchApprovalRole ?? "admin",
      launchReady,
    },
    idempotencyKey: `activation:${sessionId}:policy`,
  });

  await recordActivationWorkflowStep(context, {
    nodeId: "ApplyActivationBundle",
    stepType: "worker",
    status: "succeeded",
    startedAt: now,
    finishedAt: now,
    outputJson: {
      outboxStatusCounts: summary.outboxStatusCounts,
      pendingApplyItems: summary.pendingApplyItems,
      failedApplyItems: summary.failedApplyItems,
    },
    idempotencyKey: `activation:${sessionId}:apply`,
  });

  await recordActivationWorkflowEvidence(context, {
    evidenceType: "activation-timeline",
    title: "Activation timeline",
    summary: `Activation session ${sessionId} is ${session.status}.`,
    artifactJson: summary,
    complianceTags: ["activation", "workflow"],
    idempotencyKey: `activation:${sessionId}:timeline`,
  });

  await recordActivationWorkflowEvidence(context, {
    evidenceType: "launch-approval",
    title: "Launch approval",
    summary: launchReady
      ? "Activation is ready for launch review or has been applied."
      : "Activation is still collecting readiness inputs.",
    artifactJson: {
      sessionId,
      status: session.status,
      launchReady,
      policy: event.policy ?? {},
    },
    complianceTags: ["activation", "launch-readiness"],
    idempotencyKey: `activation:${sessionId}:launch-approval`,
  });

  await recordActivationWorkflowStep(context, {
    nodeId: "RecordLaunchDecision",
    stepType: "evidence",
    status: "succeeded",
    startedAt: now,
    finishedAt: now,
    outputJson: { launchReady },
    idempotencyKey: `activation:${sessionId}:launch-decision`,
  });

  await updateActivationWorkflowRunSummary(context, {
    workflow: "tenant-agent-activation",
    ok: true,
    launchReady,
    ...summary,
  });

  return {
    ok: true,
    sessionId,
    status: session.status,
    launchReady,
    summary,
  };
}

function workflowContext(
  event: ActivationWorkflowAdapterEvent,
): ActivationSystemWorkflowContext | null {
  if (!event.tenantId || !event.systemWorkflowRunId) return null;
  return {
    tenantId: event.tenantId,
    runId: event.systemWorkflowRunId,
    executionArn: event.systemWorkflowExecutionArn ?? null,
  };
}

async function fail(
  context: ActivationSystemWorkflowContext | null,
  sessionId: string,
  error: string,
): Promise<ActivationWorkflowAdapterResult> {
  await recordActivationWorkflowStep(context, {
    nodeId: "TrackReadiness",
    stepType: "checkpoint",
    status: "failed",
    finishedAt: new Date(),
    errorJson: { error },
    idempotencyKey: `activation:${sessionId}:failure`,
  });
  await updateActivationWorkflowRunSummary(context, {
    workflow: "tenant-agent-activation",
    ok: false,
    sessionId,
    error,
  });
  return { ok: false, sessionId, error };
}

function activationSummary(
  session: typeof activationSessions.$inferSelect,
  outboxRows: Array<typeof activationApplyOutbox.$inferSelect>,
  policy: Record<string, unknown>,
): Record<string, unknown> {
  const layerStates =
    typeof session.layer_states === "object" && session.layer_states !== null
      ? (session.layer_states as Record<string, unknown>)
      : {};
  const outboxStatusCounts = outboxRows.reduce<Record<string, number>>(
    (counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    },
    {},
  );

  return {
    sessionId: session.id,
    tenantId: session.tenant_id,
    userId: session.user_id,
    mode: session.mode,
    focusLayer: session.focus_layer,
    currentLayer: session.current_layer,
    status: session.status,
    completedLayerCount: Object.keys(layerStates).length,
    completedLayerIds: Object.keys(layerStates).sort(),
    outboxStatusCounts,
    pendingApplyItems: outboxStatusCounts.pending ?? 0,
    failedApplyItems: outboxStatusCounts.failed ?? 0,
    securityAttestationRequired: policy.securityAttestationRequired ?? true,
    launchApprovalRole: policy.launchApprovalRole ?? "admin",
  };
}
