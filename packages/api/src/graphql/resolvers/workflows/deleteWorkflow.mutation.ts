import { GraphQLError } from "graphql";
import { eq } from "drizzle-orm";
import { workflows as workflowsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";

export async function deleteWorkflow(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
  deps: { db?: typeof defaultDb } = {},
): Promise<string> {
  const id = args.id.trim();
  if (!id) {
    throw new GraphQLError("Workflow id is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const db = deps.db ?? defaultDb;
  const [workflow] = await db
    .select({
      id: workflowsTable.id,
      tenant_id: workflowsTable.tenant_id,
    })
    .from(workflowsTable)
    .where(eq(workflowsTable.id, id))
    .limit(1);

  if (!workflow) {
    throw new GraphQLError("Workflow not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  await requireTenantAdmin(ctx, workflow.tenant_id, db);
  await db.delete(workflowsTable).where(eq(workflowsTable.id, id));
  return workflow.id;
}
