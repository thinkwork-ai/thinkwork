import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  desc,
  eq,
  scheduledJobs,
  snakeToCamel,
  sql,
} from "../../utils.js";

export const scheduledJobs_ = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const conditions = [eq(scheduledJobs.tenant_id, args.tenantId)];
  if (args.agentId) conditions.push(eq(scheduledJobs.agent_id, args.agentId));
  if (args.computerId)
    conditions.push(eq(scheduledJobs.computer_id, args.computerId));
  if (args.routineId)
    conditions.push(eq(scheduledJobs.routine_id, args.routineId));
  const triggerType = args.triggerType ?? args.jobType;
  if (triggerType) conditions.push(eq(scheduledJobs.trigger_type, triggerType));
  if (args.enabled !== undefined)
    conditions.push(eq(scheduledJobs.enabled, args.enabled));
  if (args.connectionId) {
    conditions.push(
      sql`${scheduledJobs.config}->'connectorTrigger'->>'connectionId' = ${args.connectionId}`,
    );
  }
  const limit = Math.min(args.limit || 50, 200);
  const rows = await db
    .select()
    .from(scheduledJobs)
    .where(and(...conditions))
    .orderBy(desc(scheduledJobs.created_at))
    .limit(limit);
  return rows.map(snakeToCamel);
};
