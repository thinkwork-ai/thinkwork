import type { GraphQLContext } from "../../context.js";
import {
  db,
  scheduledJobs,
  spaces,
  snakeToCamel,
  invokeJobScheduleManager,
  eq,
} from "../../utils.js";
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

  if (i.spaceId) {
    const [spaceRow] = await db
      .select({ tenant_id: spaces.tenant_id })
      .from(spaces)
      .where(eq(spaces.id, i.spaceId));
    if (!spaceRow) {
      throw new Error(`Space ${i.spaceId} not found`);
    }
    if (spaceRow.tenant_id !== i.tenantId) {
      throw new Error("Space does not belong to this tenant");
    }
  }

  const config = parseConfig(i.config);
  const scheduleType = i.scheduleType ?? null;

  const [row] = await db
    .insert(scheduledJobs)
    .values({
      tenant_id: i.tenantId,
      trigger_type: triggerType,
      agent_id: i.agentId || null,
      space_id: i.spaceId || null,
      routine_id: i.routineId || null,
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
      spaceId: i.spaceId || undefined,
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
