import {
  and,
  db,
  eq,
  invokeJobScheduleManager,
  scheduledJobs,
} from "../../graphql/utils.js";

export const AGENT_LOOP_SCHEDULE_TRIGGER_TYPE = "agent_loop_schedule";

export interface AgentLoopScheduleSpec {
  family: string;
  enabled: boolean;
  scheduleId?: string;
  source?: string;
  config: Record<string, unknown>;
}

export interface SyncAgentLoopScheduleBindingInput {
  tenantId: string;
  agentLoopId: string;
  name: string;
  description?: string | null;
  goalObjective: string;
  workerAgentId?: string | null;
  triggerSpec: AgentLoopScheduleSpec;
  loopEnabled: boolean;
  actorId?: string | null;
}

export interface SyncAgentLoopScheduleBindingResult {
  scheduledJobId: string | null;
  changed: boolean;
}

export async function syncAgentLoopScheduleBinding(
  input: SyncAgentLoopScheduleBindingInput,
): Promise<SyncAgentLoopScheduleBindingResult> {
  const existing = await loadScheduledJob(input.tenantId, input.agentLoopId);

  if (input.triggerSpec.family !== "schedule") {
    if (!existing || existing.enabled === false) {
      return { scheduledJobId: existing?.id ?? null, changed: false };
    }
    await updateSchedule(existing.id, input.tenantId, { enabled: false });
    return { scheduledJobId: existing.id, changed: true };
  }

  const schedule = readScheduleConfig(input.triggerSpec.config);
  if (!schedule.scheduleExpression) {
    throw new Error(
      "Scheduled AgentLoop trigger requires config.scheduleExpression",
    );
  }

  const enabled = input.loopEnabled && input.triggerSpec.enabled !== false;
  const config = {
    internal: true,
    product: "agent_loop",
    agentLoopId: input.agentLoopId,
    triggerSource: input.triggerSpec.source ?? "agent_loop",
  };

  if (!existing) {
    const [row] = await db
      .insert(scheduledJobs)
      .values({
        tenant_id: input.tenantId,
        agent_loop_id: input.agentLoopId,
        trigger_type: AGENT_LOOP_SCHEDULE_TRIGGER_TYPE,
        agent_id: input.workerAgentId ?? null,
        name: input.name,
        description: input.description ?? null,
        prompt: input.goalObjective,
        config,
        schedule_type: schedule.scheduleType,
        schedule_expression: schedule.scheduleExpression,
        timezone: schedule.timezone,
        enabled,
        created_by_type: input.actorId ? "user" : "system",
        created_by_id: input.actorId ?? null,
      })
      .returning({ id: scheduledJobs.id });

    await createSchedule({
      triggerId: row.id,
      tenantId: input.tenantId,
      workerAgentId: input.workerAgentId,
      name: input.name,
      scheduleType: schedule.scheduleType,
      scheduleExpression: schedule.scheduleExpression,
      timezone: schedule.timezone,
      prompt: input.goalObjective,
      config,
      enabled,
    });
    return { scheduledJobId: row.id, changed: true };
  }

  const desired = {
    name: input.name,
    description: input.description ?? null,
    prompt: input.goalObjective,
    agent_id: input.workerAgentId ?? null,
    schedule_type: schedule.scheduleType,
    schedule_expression: schedule.scheduleExpression,
    timezone: schedule.timezone,
    enabled,
  };
  if (
    existing.name === desired.name &&
    existing.description === desired.description &&
    existing.prompt === desired.prompt &&
    existing.agent_id === desired.agent_id &&
    existing.schedule_type === desired.schedule_type &&
    existing.schedule_expression === desired.schedule_expression &&
    existing.timezone === desired.timezone &&
    existing.enabled === desired.enabled
  ) {
    return { scheduledJobId: existing.id, changed: false };
  }

  await updateSchedule(existing.id, input.tenantId, {
    name: desired.name,
    description: desired.description,
    prompt: desired.prompt,
    agentId: desired.agent_id,
    scheduleType: desired.schedule_type,
    scheduleExpression: desired.schedule_expression,
    timezone: desired.timezone,
    enabled: desired.enabled,
    config,
  });
  return { scheduledJobId: existing.id, changed: true };
}

async function loadScheduledJob(tenantId: string, agentLoopId: string) {
  const [row] = await db
    .select({
      id: scheduledJobs.id,
      name: scheduledJobs.name,
      description: scheduledJobs.description,
      prompt: scheduledJobs.prompt,
      agent_id: scheduledJobs.agent_id,
      schedule_type: scheduledJobs.schedule_type,
      schedule_expression: scheduledJobs.schedule_expression,
      timezone: scheduledJobs.timezone,
      enabled: scheduledJobs.enabled,
    })
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.tenant_id, tenantId),
        eq(scheduledJobs.agent_loop_id, agentLoopId),
        eq(scheduledJobs.trigger_type, AGENT_LOOP_SCHEDULE_TRIGGER_TYPE),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function createSchedule(input: {
  triggerId: string;
  tenantId: string;
  workerAgentId?: string | null;
  name: string;
  scheduleType: string;
  scheduleExpression: string;
  timezone: string;
  prompt: string;
  config: Record<string, unknown>;
  enabled: boolean;
}): Promise<void> {
  const result = await invokeJobScheduleManager("POST", {
    triggerId: input.triggerId,
    tenantId: input.tenantId,
    triggerType: AGENT_LOOP_SCHEDULE_TRIGGER_TYPE,
    agentId: input.workerAgentId ?? undefined,
    name: input.name,
    scheduleType: input.scheduleType,
    scheduleExpression: input.scheduleExpression,
    timezone: input.timezone,
    prompt: input.prompt,
    config: input.config,
    createdByType: "system",
    enabled: input.enabled,
  });
  if (!result.ok) {
    throw new Error(
      `AgentLoop saved but EventBridge schedule could not be provisioned: ${result.error}. Save the AgentLoop again to retry schedule repair.`,
    );
  }
}

async function updateSchedule(
  triggerId: string,
  tenantId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const result = await invokeJobScheduleManager("PUT", {
    triggerId,
    tenantId,
    ...patch,
  });
  if (!result.ok) {
    throw new Error(
      `AgentLoop schedule update failed: ${result.error}. Retry save to repair the scheduled_jobs/EventBridge binding.`,
    );
  }
}

function readScheduleConfig(config: Record<string, unknown>): {
  scheduleType: string;
  scheduleExpression: string;
  timezone: string;
} {
  const scheduleType = stringValue(config.scheduleType, "rate");
  const scheduleExpression = stringValue(config.scheduleExpression, "");
  const timezone = stringValue(config.timezone, "UTC");
  return { scheduleType, scheduleExpression, timezone };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
