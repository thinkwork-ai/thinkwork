import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaces as spacesTable } from "../../utils.js";
import {
  canReadTenantSpaces,
  parseSpaceStatus,
  toGraphqlSpace,
} from "./shared.js";

export async function spaces(
  _parent: any,
  args: { tenantId: string; status?: string | null },
  ctx: GraphQLContext,
) {
  if (!(await canReadTenantSpaces(ctx, args.tenantId))) {
    return [];
  }

  const conditions = [eq(spacesTable.tenant_id, args.tenantId)];
  const status = parseSpaceStatus(args.status);
  if (status) conditions.push(eq(spacesTable.status, status));

  const rows = await db
    .select()
    .from(spacesTable)
    .where(and(...conditions));
  return rows.map((row) => toGraphqlSpace(row));
}
