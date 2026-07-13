import { and, desc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import {
  workflowRuns as workflowRunsTable,
  workflows as workflowsTable,
} from "@thinkwork/database-pg/schema";
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

export async function workflowRuns(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    scope?: WorkflowReadScope | null;
    workflowId?: string | null;
    status?: string | null;
    limit?: number | null;
    cursor?: string | null;
  },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const conditions = [];

  if (args.workflowId) {
    const [workflow] = await db
      .select({
        tenant_id: workflowsTable.tenant_id,
        visibility: workflowsTable.visibility,
        owner_user_id: workflowsTable.owner_user_id,
        source_agent_loop_id: workflowsTable.source_agent_loop_id,
      })
      .from(workflowsTable)
      .where(eq(workflowsTable.id, args.workflowId))
      .limit(1);
    if (!workflow) return [];
    const readAccess = await resolveWorkflowReadAccess(
      ctx,
      workflow.tenant_id,
      args.scope ?? "USER",
    );
    if (
      !readAccess.includePrivate &&
      isWorkflowHiddenFromCaller(workflow, await resolveCallerUserId(ctx))
    ) {
      return [];
    }
    conditions.push(eq(workflowRunsTable.tenant_id, workflow.tenant_id));
    conditions.push(eq(workflowRunsTable.workflow_id, args.workflowId));
  } else {
    const readAccess = await resolveWorkflowReadAccess(
      ctx,
      args.tenantId,
      args.scope ?? "USER",
    );
    const { tenantId } = readAccess;
    conditions.push(eq(workflowRunsTable.tenant_id, tenantId));

    if (!readAccess.includePrivate) {
      const callerUserId = await resolveCallerUserId(ctx);
      const readableConditions = [
        ne(workflowsTable.visibility, "agent_private"),
        and(
          isNull(workflowsTable.owner_user_id),
          isNull(workflowsTable.source_agent_loop_id),
        ),
      ];
      if (callerUserId) {
        readableConditions.push(eq(workflowsTable.owner_user_id, callerUserId));
      }
      const readableWorkflowIds = db
        .select({
          id: workflowsTable.id,
        })
        .from(workflowsTable)
        .where(
          and(
            eq(workflowsTable.tenant_id, tenantId),
            or(...readableConditions),
          ),
        );
      conditions.push(
        inArray(workflowRunsTable.workflow_id, readableWorkflowIds),
      );
    }
  }

  const status = normalizeWorkflowEnum(args.status);
  if (status) {
    conditions.push(eq(workflowRunsTable.status, status));
  }

  if (args.cursor) {
    conditions.push(lt(workflowRunsTable.created_at, new Date(args.cursor)));
  }

  const rows = await db
    .select()
    .from(workflowRunsTable)
    .where(and(...conditions))
    .orderBy(desc(workflowRunsTable.created_at))
    .limit(clampWorkflowQueryLimit(args.limit));

  return rows.map(snakeToCamel);
}
