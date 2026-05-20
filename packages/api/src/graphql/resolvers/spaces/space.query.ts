import type { GraphQLContext } from "../../context.js";
import { db, eq, spaces } from "../../utils.js";
import { canReadTenantSpaces, toGraphqlSpace } from "./shared.js";

export async function space(
  _parent: any,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const [row] = await db.select().from(spaces).where(eq(spaces.id, args.id));
  if (!row) return null;
  if (!(await canReadTenantSpaces(ctx, row.tenant_id))) return null;
  return toGraphqlSpace(row);
}
