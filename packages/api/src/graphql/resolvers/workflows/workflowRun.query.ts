import { eq } from "drizzle-orm";
import {
  workflowRuns as workflowRunsTable,
  workflows as workflowsTable,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { canReadWorkflow, type WorkflowReadScope } from "./types.js";

export async function workflowRun(
  _parent: unknown,
  args: { id: string; scope?: WorkflowReadScope | null },
  ctx: GraphQLContext,
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(workflowRunsTable)
    .where(eq(workflowRunsTable.id, args.id))
    .limit(1);

  if (row) {
    const [workflow] = await db
      .select({
        tenant_id: workflowsTable.tenant_id,
        visibility: workflowsTable.visibility,
        owner_user_id: workflowsTable.owner_user_id,
        source_agent_loop_id: workflowsTable.source_agent_loop_id,
      })
      .from(workflowsTable)
      .where(eq(workflowsTable.id, row.workflow_id))
      .limit(1);
    if (
      !workflow ||
      !(await canReadWorkflow(ctx, workflow, args.scope ?? "USER"))
    ) {
      return null;
    }
  }

  return row ? snakeToCamel(row) : null;
}
