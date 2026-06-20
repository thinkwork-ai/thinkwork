import { and, desc, eq, lt } from "drizzle-orm";
import {
  workflowRuns as workflowRunsTable,
  workflows as workflowsTable,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import {
  assertCanReadWorkflowTenant,
  clampWorkflowQueryLimit,
  normalizeWorkflowEnum,
  resolveReadableTenantId,
} from "./types.js";

export async function workflowRuns(
  _parent: unknown,
  args: {
    tenantId?: string | null;
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
      .select({ tenant_id: workflowsTable.tenant_id })
      .from(workflowsTable)
      .where(eq(workflowsTable.id, args.workflowId))
      .limit(1);
    if (!workflow) return [];
    await assertCanReadWorkflowTenant(ctx, workflow.tenant_id);
    conditions.push(eq(workflowRunsTable.tenant_id, workflow.tenant_id));
    conditions.push(eq(workflowRunsTable.workflow_id, args.workflowId));
  } else {
    const tenantId = await resolveReadableTenantId(ctx, args.tenantId);
    conditions.push(eq(workflowRunsTable.tenant_id, tenantId));
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
