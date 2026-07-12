import { eq } from "drizzle-orm";
import {
  workflowRuns as workflowRunsTable,
  workflows as workflowsTable,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  assertCanReadWorkflowTenant,
  isWorkflowHiddenFromCaller,
} from "./types.js";

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
    // THINK-193 U3: runs of another user's personal automation read as
    // absent — the run detail (preflight plan, evidence) is owner-only.
    const [workflow] = await db
      .select({
        visibility: workflowsTable.visibility,
        owner_user_id: workflowsTable.owner_user_id,
      })
      .from(workflowsTable)
      .where(eq(workflowsTable.id, row.workflow_id))
      .limit(1);
    if (
      workflow &&
      isWorkflowHiddenFromCaller(workflow, await resolveCallerUserId(ctx))
    ) {
      return null;
    }
  }

  return row ? snakeToCamel(row) : null;
}
