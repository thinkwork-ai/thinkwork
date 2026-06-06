import type { GraphQLContext } from "../../context.js";
import { db, eq, and, or, sql, scheduledJobs, users } from "../../utils.js";

export const unpauseUserBudget = async (
  _parent: any,
  args: any,
  _ctx: GraphQLContext,
) => {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, args.userId), eq(users.tenant_id, args.tenantId)))
    .limit(1);
  if (!user) {
    throw new Error("User not found in tenant");
  }

  const rows = await db
    .update(scheduledJobs)
    .set({
      budget_paused: false,
      budget_paused_at: null,
      budget_paused_reason: null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(scheduledJobs.tenant_id, args.tenantId),
        eq(scheduledJobs.enabled, true),
        eq(scheduledJobs.budget_paused, true),
        sql`${scheduledJobs.budget_paused_reason} LIKE 'User budget exceeded:%'`,
        or(
          and(
            eq(scheduledJobs.created_by_type, "user"),
            eq(scheduledJobs.created_by_id, args.userId),
          ),
          sql`${scheduledJobs.config}->>'invokerUserId' = ${args.userId}`,
        ),
      ),
    )
    .returning({ id: scheduledJobs.id });

  return rows.length;
};
