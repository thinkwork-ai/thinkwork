import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaceMembers, spaces, users } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { toGraphqlSpaceChild } from "./shared.js";

export async function addSpaceMember(
  _parent: unknown,
  args: { spaceId: string; userId: string },
  ctx: GraphQLContext,
) {
  const [space] = await db
    .select({
      tenant_id: spaces.tenant_id,
      access_mode: spaces.access_mode,
    })
    .from(spaces)
    .where(eq(spaces.id, args.spaceId));

  if (!space) throw new GraphQLError("Space not found");

  await requireAdminOrServiceCaller(
    ctx,
    space.tenant_id,
    "manage_space_members",
  );

  if (space.access_mode !== "private") {
    throw new GraphQLError(
      "Members can only be managed on private Spaces",
      { extensions: { code: "SPACE_NOT_PRIVATE" } },
    );
  }

  const [user] = await db
    .select({ id: users.id, tenant_id: users.tenant_id })
    .from(users)
    .where(eq(users.id, args.userId));

  if (!user || user.tenant_id !== space.tenant_id) {
    throw new GraphQLError("User does not belong to this Space's tenant", {
      extensions: { code: "USER_NOT_IN_TENANT" },
    });
  }

  await db
    .insert(spaceMembers)
    .values({
      tenant_id: space.tenant_id,
      space_id: args.spaceId,
      user_id: args.userId,
      role: "member",
      notification_preference: "subscribed",
    })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.tenant_id, space.tenant_id),
        eq(spaceMembers.space_id, args.spaceId),
        eq(spaceMembers.user_id, args.userId),
      ),
    );

  if (!row) throw new GraphQLError("Space member insert failed");

  return toGraphqlSpaceChild(row);
}
