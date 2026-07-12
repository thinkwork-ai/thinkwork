/**
 * setPersonalMemoryAutomationSchedule — owner-only schedule toggle for the
 * caller's Personal Memory Automation (THINK-193 U3, R6).
 *
 * The definition stays blueprint-owned; only the schedule trigger binding
 * (scheduled_jobs via job-schedule-manager) and the workflow's primary
 * trigger family change. Scheduled runs skip plan review visibly and stay
 * inside the saved envelope (AE2).
 */

import { eq } from "drizzle-orm";
import { workflows as workflowsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { ensurePersonalMemoryAutomation } from "../../../lib/memory-sources/provisioning.js";
import { syncWorkflowScheduleBinding } from "../../../lib/workflows/schedule-binding.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { toGraphqlManagedMemoryWorkflow } from "./managed-memory-workflow.js";

const SCHEDULE_EXPRESSION_PATTERN = /^(rate|cron)\(.+\)$/;

export async function setPersonalMemoryAutomationSchedule(
  _parent: unknown,
  args: {
    scheduleExpression?: string | null;
    timezone?: string | null;
    enabled: boolean;
  },
  ctx: GraphQLContext,
) {
  const tenantId = ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  const userId = await resolveCallerUserId(ctx);
  if (!userId) {
    throw new Error(
      "A signed-in user is required — personal memory automations belong to a user, not a service caller",
    );
  }

  const expression = args.scheduleExpression?.trim() ?? "";
  if (args.enabled) {
    if (!SCHEDULE_EXPRESSION_PATTERN.test(expression)) {
      throw new Error(
        "Enabling the schedule requires an EventBridge Scheduler expression: rate(...) or cron(...)",
      );
    }
  }

  // Owner-only by construction: the automation is the CALLER's.
  const ensured = await ensurePersonalMemoryAutomation(db, {
    tenantId,
    userId,
  });
  if (!ensured.workflow) {
    throw new Error("Personal memory workflow could not be provisioned");
  }

  await syncWorkflowScheduleBinding({
    tenantId,
    workflowId: ensured.workflow.id,
    name: ensured.workflow.name,
    schedule: args.enabled
      ? {
          scheduleExpression: expression,
          timezone: args.timezone ?? null,
          enabled: true,
        }
      : null,
    actorId: userId,
  });

  await db
    .update(workflowsTable)
    .set({
      primary_trigger_family: args.enabled ? "schedule" : "manual",
      updated_at: new Date(),
    })
    .where(eq(workflowsTable.id, ensured.workflow.id));

  const fresh = await ensurePersonalMemoryAutomation(db, { tenantId, userId });
  return toGraphqlManagedMemoryWorkflow(fresh);
}
