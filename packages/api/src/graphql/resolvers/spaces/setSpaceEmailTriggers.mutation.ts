import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaces } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { toGraphqlSpace } from "./shared.js";

export async function setSpaceEmailTriggers(
  _parent: unknown,
  args: { spaceId: string; enabled: boolean },
  ctx: GraphQLContext,
) {
  const [space] = await db
    .select({ tenant_id: spaces.tenant_id })
    .from(spaces)
    .where(eq(spaces.id, args.spaceId));

  if (!space) throw new GraphQLError("Space not found");

  await requireAdminOrServiceCaller(
    ctx,
    space.tenant_id,
    "set_space_email_triggers",
  );

  const [row] = await db
    .update(spaces)
    .set({
      email_triggers_enabled: args.enabled,
      updated_at: new Date(),
    })
    .where(
      and(eq(spaces.id, args.spaceId), eq(spaces.tenant_id, space.tenant_id)),
    )
    .returning();

  if (!row) throw new GraphQLError("Space not found");

  return toGraphqlSpace(row);
}
