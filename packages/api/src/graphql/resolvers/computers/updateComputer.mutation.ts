import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, computers, sql } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  parseComputerStatus,
  parseDesiredRuntimeStatus,
  parseJsonInput,
  parseOptionalDate,
  parseRuntimeStatus,
  requireComputerTemplate,
  toGraphqlComputer,
} from "./shared.js";

export async function updateComputer(
  _parent: any,
  args: { id: string; input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const [existing] = await db
    .select()
    .from(computers)
    .where(eq(computers.id, args.id));
  if (!existing) {
    throw new GraphQLError("Computer not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantAdmin(ctx, existing.tenant_id);

  const input = args.input;
  const set: Record<string, unknown> = { updated_at: sql`now()` };
  if (input.name !== undefined) set.name = input.name;
  if (input.slug !== undefined) set.slug = input.slug;
  if (input.templateId !== undefined) {
    await requireComputerTemplate(existing.tenant_id, input.templateId);
    set.template_id = input.templateId;
  }
  if (input.status !== undefined)
    set.status = parseComputerStatus(input.status);
  if (input.desiredRuntimeStatus !== undefined) {
    set.desired_runtime_status = parseDesiredRuntimeStatus(
      input.desiredRuntimeStatus,
    );
  }
  if (input.runtimeStatus !== undefined) {
    set.runtime_status = parseRuntimeStatus(input.runtimeStatus);
  }
  if (input.runtimeConfig !== undefined) {
    set.runtime_config = parseJsonInput(input.runtimeConfig);
  }
  if (input.liveWorkspaceRoot !== undefined) {
    set.live_workspace_root = input.liveWorkspaceRoot;
  }
  if (input.efsAccessPointId !== undefined) {
    set.efs_access_point_id = input.efsAccessPointId;
  }
  if (input.ecsServiceName !== undefined) {
    set.ecs_service_name = input.ecsServiceName;
  }
  if (input.lastHeartbeatAt !== undefined) {
    set.last_heartbeat_at = parseOptionalDate(input.lastHeartbeatAt);
  }
  if (input.lastActiveAt !== undefined) {
    set.last_active_at = parseOptionalDate(input.lastActiveAt);
  }
  if (input.budgetMonthlyCents !== undefined) {
    set.budget_monthly_cents = input.budgetMonthlyCents;
  }
  if (input.spentMonthlyCents !== undefined) {
    set.spent_monthly_cents = input.spentMonthlyCents;
  }
  if (input.budgetPausedReason !== undefined) {
    set.budget_paused_reason = input.budgetPausedReason;
  }

  const [row] = await db
    .update(computers)
    .set(set)
    .where(eq(computers.id, args.id))
    .returning();
  return toGraphqlComputer(row);
}
