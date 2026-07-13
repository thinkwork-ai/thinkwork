import { and, desc, eq, lt } from "drizzle-orm";
import { workflows as workflowsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  clampWorkflowQueryLimit,
  isWorkflowHiddenFromCaller,
  normalizeWorkflowEnum,
  resolveWorkflowReadAccess,
  type WorkflowReadScope,
} from "./types.js";

export async function workflows(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    scope?: WorkflowReadScope | null;
    lifecycleStatus?: string | null;
    readinessState?: string | null;
    limit?: number | null;
    cursor?: string | null;
  },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const readAccess = await resolveWorkflowReadAccess(
    ctx,
    args.tenantId,
    args.scope ?? "USER",
  );
  const tenantId = readAccess.tenantId;
  const conditions = [eq(workflowsTable.tenant_id, tenantId)];

  const lifecycleStatus = normalizeWorkflowEnum(args.lifecycleStatus);
  if (lifecycleStatus) {
    conditions.push(eq(workflowsTable.lifecycle_status, lifecycleStatus));
  }

  const readinessState = normalizeWorkflowEnum(args.readinessState);
  if (readinessState) {
    conditions.push(eq(workflowsTable.readiness_state, readinessState));
  }

  if (args.cursor) {
    conditions.push(lt(workflowsTable.updated_at, new Date(args.cursor)));
  }

  const rows = await db
    .select()
    .from(workflowsTable)
    .where(and(...conditions))
    .orderBy(desc(workflowsTable.updated_at))
    .limit(clampWorkflowQueryLimit(args.limit));

  // THINK-193 U3: hide OTHER users' personal (user-owned agent_private)
  // workflows — they are owner-only surfaces, not tenant inventory.
  if (readAccess.includePrivate) return rows.map(snakeToCamel);
  const callerUserId = await resolveCallerUserId(ctx);
  return rows
    .filter((row) => !isWorkflowHiddenFromCaller(row, callerUserId))
    .map(snakeToCamel);
}
