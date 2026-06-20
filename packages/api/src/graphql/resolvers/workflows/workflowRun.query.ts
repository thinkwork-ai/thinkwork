import { eq } from "drizzle-orm";
import { workflowRuns as workflowRunsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { assertCanReadWorkflowTenant } from "./types.js";

export async function workflowRun(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(workflowRunsTable)
    .where(eq(workflowRunsTable.id, args.id))
    .limit(1);

  if (row) {
    await assertCanReadWorkflowTenant(ctx, row.tenant_id);
  }

  return row ? snakeToCamel(row) : null;
}
