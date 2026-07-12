import { eq } from "drizzle-orm";
import { workflows as workflowsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  assertCanReadWorkflowTenant,
  isWorkflowHiddenFromCaller,
} from "./types.js";

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
    // THINK-193 U3: another user's personal automation reads as absent —
    // never leak its existence or configuration.
    if (isWorkflowHiddenFromCaller(row, await resolveCallerUserId(ctx))) {
      return null;
    }
  }

  return row ? snakeToCamel(row) : null;
}
