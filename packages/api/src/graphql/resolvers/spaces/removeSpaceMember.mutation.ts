import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaceMembers, spaces } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export async function removeSpaceMember(
  _parent: unknown,
  args: { spaceId: string; userId: string },
  ctx: GraphQLContext,
): Promise<boolean> {
  const [space] = await db
    .select({ tenant_id: spaces.tenant_id })
    .from(spaces)
    .where(eq(spaces.id, args.spaceId));

  if (!space) throw new GraphQLError("Space not found");

  await requireAdminOrServiceCaller(
    ctx,
    space.tenant_id,
    "manage_space_members",
  );

  const [existing] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.tenant_id, space.tenant_id),
        eq(spaceMembers.space_id, args.spaceId),
        eq(spaceMembers.user_id, args.userId),
      ),
    );

  if (!existing) return false;

  if (existing.role === "owner") {
    throw new GraphQLError("Cannot remove the Space owner", {
      extensions: { code: "CANNOT_REMOVE_OWNER" },
    });
  }

  await db
    .delete(spaceMembers)
    .where(
      and(
        eq(spaceMembers.tenant_id, space.tenant_id),
        eq(spaceMembers.space_id, args.spaceId),
        eq(spaceMembers.user_id, args.userId),
      ),
    );

  return true;
}
