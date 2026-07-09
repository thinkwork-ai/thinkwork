/**
 * Workflow schedule-trigger binding (THINK-218).
 *
 * Mirrors lib/agent-loops/schedule-binding.ts for the canonical workflow
 * control plane: one scheduled_jobs row per workflow (trigger_type
 * `workflow_schedule`), provisioned/updated through the job-schedule-manager
 * Lambda so the EventBridge schedule is real, not just a row.
 */
import {
  and,
  db,
  eq,
  invokeJobScheduleManager,
  scheduledJobs,
} from "../../graphql/utils.js";

export const WORKFLOW_SCHEDULE_TRIGGER_TYPE = "workflow_schedule";

export interface WorkflowScheduleSpec {
  /** rate(...) / cron(...) EventBridge Scheduler expression. */
  scheduleExpression: string;
  timezone?: string | null;
  enabled?: boolean;
}

export interface SyncWorkflowScheduleBindingInput {
  tenantId: string;
  workflowId: string;
  name: string;
  description?: string | null;
  schedule: WorkflowScheduleSpec | null;
  actorId?: string | null;
}

export interface SyncWorkflowScheduleBindingResult {
  scheduledJobId: string | null;
  changed: boolean;
}

export async function syncWorkflowScheduleBinding(
  input: SyncWorkflowScheduleBindingInput,
): Promise<SyncWorkflowScheduleBindingResult> {
  const [existing] = await db
    .select({ id: scheduledJobs.id, enabled: scheduledJobs.enabled })
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.tenant_id, input.tenantId),
        eq(scheduledJobs.workflow_id, input.workflowId),
        eq(scheduledJobs.trigger_type, WORKFLOW_SCHEDULE_TRIGGER_TYPE),
      ),
    )
    .limit(1);

  // No schedule trigger: disable an existing binding rather than deleting it
  // (history stays attached; re-enabling restores the same job).
  if (!input.schedule) {
    if (!existing || existing.enabled === false) {
      return { scheduledJobId: existing?.id ?? null, changed: false };
    }
    const disabled = await invokeJobScheduleManager("PUT", {
      triggerId: existing.id,
      tenantId: input.tenantId,
      enabled: false,
    });
    if (!disabled.ok) {
      throw new Error(
        `Workflow schedule disable failed: ${disabled.error}. Retry save to repair the scheduled_jobs/EventBridge binding.`,
      );
    }
    return { scheduledJobId: existing.id, changed: true };
  }

  const expression = input.schedule.scheduleExpression.trim();
  if (!expression) {
    throw new Error("A schedule trigger requires a scheduleExpression");
  }
  const enabled = input.schedule.enabled !== false;
  const shared = {
    tenantId: input.tenantId,
    triggerType: WORKFLOW_SCHEDULE_TRIGGER_TYPE,
    workflowId: input.workflowId,
    name: input.name,
    description: input.description ?? null,
    scheduleType: expression.startsWith("cron(") ? "cron" : "rate",
    scheduleExpression: expression,
    timezone: input.schedule.timezone ?? "UTC",
    enabled,
    createdByType: input.actorId ? "user" : "system",
    createdById: input.actorId ?? null,
    config: { internal: true, product: "workflow" },
  };

  if (!existing) {
    const created = await invokeJobScheduleManager("POST", shared);
    if (!created.ok) {
      throw new Error(
        `Workflow saved but EventBridge schedule could not be provisioned: ${created.error}. Save again to retry schedule repair.`,
      );
    }
    // The manager creates the scheduled_jobs row itself; its result carries
    // no id, so re-select for the caller.
    const [row] = await db
      .select({ id: scheduledJobs.id })
      .from(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.tenant_id, input.tenantId),
          eq(scheduledJobs.workflow_id, input.workflowId),
          eq(scheduledJobs.trigger_type, WORKFLOW_SCHEDULE_TRIGGER_TYPE),
        ),
      )
      .limit(1);
    return { scheduledJobId: row?.id ?? null, changed: true };
  }
  const updated = await invokeJobScheduleManager("PUT", {
    triggerId: existing.id,
    ...shared,
  });
  if (!updated.ok) {
    throw new Error(
      `Workflow schedule update failed: ${updated.error}. Retry save to repair the scheduled_jobs/EventBridge binding.`,
    );
  }
  return { scheduledJobId: existing.id, changed: true };
}
