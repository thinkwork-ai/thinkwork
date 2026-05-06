import type { GraphQLContext } from "../../context.js";
import { db, and, eq, ne, computers } from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { toGraphqlComputer } from "./shared.js";

export async function myComputer(
  _parent: any,
  _args: any,
  ctx: GraphQLContext,
) {
  const caller = await resolveCaller(ctx);
  if (!caller.userId || !caller.tenantId) return null;

  const [row] = await db
    .select()
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, caller.tenantId),
        eq(computers.owner_user_id, caller.userId),
        ne(computers.status, "archived"),
      ),
    );
  return row ? toGraphqlComputer(row) : null;
}
