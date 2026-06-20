import { and, desc, eq, lt } from "drizzle-orm";
import { workflows as workflowsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import {
  clampWorkflowQueryLimit,
  normalizeWorkflowEnum,
  resolveReadableTenantId,
} from "./types.js";

export async function workflows(
  _parent: unknown,
  args: {
    tenantId?: string | null;
    lifecycleStatus?: string | null;
    readinessState?: string | null;
    limit?: number | null;
    cursor?: string | null;
  },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const tenantId = await resolveReadableTenantId(ctx, args.tenantId);
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

  return rows.map(snakeToCamel);
}
