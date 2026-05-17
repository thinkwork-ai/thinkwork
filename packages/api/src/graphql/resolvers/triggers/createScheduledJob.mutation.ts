import type { GraphQLContext } from "../../context.js";
import {
  db,
  scheduledJobs,
  computers,
  snakeToCamel,
  invokeJobScheduleManager,
  eq,
} from "../../utils.js";
import {
  hasConnectorTriggerDefinition,
  prepareConnectorTriggerDefinition,
} from "../../../lib/computers/connector-trigger-routing.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";

export const createScheduledJob = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  const triggerType = String(i.triggerType || i.jobType || "").toLowerCase();
  const createdByType = String(i.createdByType || "user").toLowerCase();
  const caller =
    createdByType === "user" ? await resolveCallerFromAuth(ctx.auth) : null;
  const createdById =
    createdByType === "user"
      ? (caller?.userId ?? i.createdById ?? null)
      : i.createdById || null;

  // Validate that any computer_id in the input belongs to the named tenant
  // before inserting the FK. Mirrors the REST handler — see U3 / U4 of
  // the scheduled-jobs-and-automations plan.
  if (i.computerId) {
    const [computerRow] = await db
      .select({ tenant_id: computers.tenant_id })
      .from(computers)
      .where(eq(computers.id, i.computerId));
    if (!computerRow) {
      throw new Error(`Computer ${i.computerId} not found`);
    }
    if (computerRow.tenant_id !== i.tenantId) {
      throw new Error("Computer does not belong to this tenant");
    }
  }

  const parsedConfig = parseConfig(i.config);
  const connectorTrigger =
    triggerType === "event" && hasConnectorTriggerDefinition(parsedConfig)
      ? await prepareConnectorTriggerDefinition({
          tenantId: i.tenantId,
          requesterUserId: createdByType === "user" ? createdById : null,
          computerId: i.computerId || null,
          config: parsedConfig,
        })
      : null;
  const scheduleType = connectorTrigger?.scheduleType ?? i.scheduleType ?? null;
  const computerId = connectorTrigger?.computerId ?? i.computerId ?? null;
  const config = connectorTrigger?.config ?? parsedConfig;

  const [row] = await db
    .insert(scheduledJobs)
    .values({
      tenant_id: i.tenantId,
      trigger_type: connectorTrigger?.triggerType ?? triggerType,
      agent_id: i.agentId || null,
      computer_id: computerId,
      routine_id: i.routineId || null,
      team_id: i.teamId || null,
      name: i.name,
      description: i.description || null,
      prompt: i.prompt || null,
      config,
      schedule_type: scheduleType,
      schedule_expression: i.scheduleExpression,
      timezone: i.timezone || "UTC",
      enabled: true,
      created_by_type: createdByType,
      created_by_id: createdById,
    })
    .returning();
  if (row.schedule_type && row.schedule_expression) {
    const result = await invokeJobScheduleManager("POST", {
      triggerId: row.id,
      tenantId: i.tenantId,
      triggerType: row.trigger_type,
      agentId: i.agentId || undefined,
      routineId: i.routineId || undefined,
      name: i.name,
      scheduleType: row.schedule_type,
      scheduleExpression: row.schedule_expression,
      timezone: i.timezone || "UTC",
      prompt: i.prompt || undefined,
      config: config ?? undefined,
      createdByType,
    });
    if (!result.ok) {
      throw new Error(
        `Automation saved but EventBridge schedule could not be provisioned: ${result.error}. Open the automation and press Save to retry.`,
      );
    }
  }
  // Re-read to pick up eb_schedule_name populated by the manager Lambda
  const [refreshed] = await db
    .select()
    .from(scheduledJobs)
    .where(eq(scheduledJobs.id, row.id));
  return snakeToCamel(refreshed || row);
};

function parseConfig(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("config must be an object");
}
