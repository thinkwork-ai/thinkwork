import { eq } from "drizzle-orm";
import { workflows as workflowsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { assertCanReadWorkflowTenant } from "./types.js";

export async function workflow(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, args.id))
    .limit(1);

  if (row) {
    await assertCanReadWorkflowTenant(ctx, row.tenant_id);
  }

  return row ? snakeToCamel(row) : null;
}
