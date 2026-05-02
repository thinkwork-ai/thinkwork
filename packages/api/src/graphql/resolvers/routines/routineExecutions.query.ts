import { and, desc, eq, lt } from "drizzle-orm";
import {
  routineAslVersions,
  routineExecutions as routineExecutionsTable,
  routineStepEvents,
  routines,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";

export async function routineExecution(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(routineExecutionsTable)
    .where(eq(routineExecutionsTable.id, args.id))
    .limit(1);
  if (row) {
    await requireTenantMember(ctx, row.tenant_id);
  }
  return row ? snakeToCamel(row) : null;
}

export async function routineExecutions(
  _parent: unknown,
  args: {
    routineId: string;
    status?: string | null;
    limit?: number | null;
    cursor?: string | null;
  },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const [routine] = await db
    .select({ tenant_id: routines.tenant_id })
    .from(routines)
    .where(eq(routines.id, args.routineId))
    .limit(1);
  if (!routine) return [];
  await requireTenantMember(ctx, routine.tenant_id);

  const conditions = [
    eq(routineExecutionsTable.tenant_id, routine.tenant_id),
    eq(routineExecutionsTable.routine_id, args.routineId),
  ];
  if (args.status) {
    conditions.push(
      eq(routineExecutionsTable.status, args.status.toLowerCase()),
    );
  }
  if (args.cursor) {
    conditions.push(
      lt(routineExecutionsTable.started_at, new Date(args.cursor)),
    );
  }

  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
  const rows = await db
    .select()
    .from(routineExecutionsTable)
    .where(and(...conditions))
    .orderBy(desc(routineExecutionsTable.started_at))
    .limit(limit);

  return rows.map(snakeToCamel);
}

export async function routineStepEvents_(
  _parent: unknown,
  args: { executionId: string },
  ctx: GraphQLContext,
): Promise<unknown[]> {
  const [execution] = await db
    .select({ tenant_id: routineExecutionsTable.tenant_id })
    .from(routineExecutionsTable)
    .where(eq(routineExecutionsTable.id, args.executionId))
    .limit(1);
  if (!execution) return [];
  await requireTenantMember(ctx, execution.tenant_id);

  const rows = await db
    .select()
    .from(routineStepEvents)
    .where(eq(routineStepEvents.execution_id, args.executionId))
    .orderBy(routineStepEvents.started_at, routineStepEvents.created_at)
    .limit(1_000);
  return rows.map(snakeToCamel);
}

export async function routineAslVersion(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(routineAslVersions)
    .where(eq(routineAslVersions.id, args.id))
    .limit(1);
  if (row) {
    await requireTenantMember(ctx, row.tenant_id);
  }
  return row ? snakeToCamel(row) : null;
}
