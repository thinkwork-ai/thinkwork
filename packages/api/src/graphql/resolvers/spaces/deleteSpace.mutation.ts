import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaces } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export async function deleteSpace(
  _parent: unknown,
  args: { tenantId: string; id: string },
  ctx: GraphQLContext,
): Promise<boolean> {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "delete_space");

  const [row] = await db
    .update(spaces)
    .set({
      status: "archived",
      updated_at: new Date(),
    })
    .where(and(eq(spaces.id, args.id), eq(spaces.tenant_id, args.tenantId)))
    .returning({ id: spaces.id });

  if (!row) throw new GraphQLError("Space not found for tenant");
  return true;
}
