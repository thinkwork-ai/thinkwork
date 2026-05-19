import type { GraphQLContext } from "../../context.js";
import { db, eq, spaces } from "../../utils.js";
import { hasSpaceMemberAccess, toGraphqlSpace } from "./shared.js";

export async function space(
  _parent: any,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const [row] = await db.select().from(spaces).where(eq(spaces.id, args.id));
  if (!row) return null;
  if (!(await hasSpaceMemberAccess(ctx, row.tenant_id, row.id))) return null;
  return toGraphqlSpace(row);
}
