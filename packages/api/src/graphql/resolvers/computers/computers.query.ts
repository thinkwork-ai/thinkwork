import type { GraphQLContext } from "../../context.js";
import { db, and, eq, computers as computersTable } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { parseComputerStatus, toGraphqlComputer } from "./shared.js";

export async function computers(
  _parent: any,
  args: { tenantId: string; status?: string },
  ctx: GraphQLContext,
) {
  await requireTenantAdmin(ctx, args.tenantId);
  const conditions = [eq(computersTable.tenant_id, args.tenantId)];
  const status = parseComputerStatus(args.status);
  if (status) conditions.push(eq(computersTable.status, status));

  const rows = await db
    .select()
    .from(computersTable)
    .where(and(...conditions));
  return rows.map((row) => toGraphqlComputer(row));
}
