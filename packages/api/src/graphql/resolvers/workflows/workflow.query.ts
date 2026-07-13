import { eq } from "drizzle-orm";
import { workflows as workflowsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { canReadWorkflow, type WorkflowReadScope } from "./types.js";

export async function workflow(
  _parent: unknown,
  args: { id: string; scope?: WorkflowReadScope | null },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.id, args.id))
    .limit(1);

  if (row) {
    if (!(await canReadWorkflow(ctx, row, args.scope ?? "USER"))) {
      return null;
    }
  }

  return row ? snakeToCamel(row) : null;
}
