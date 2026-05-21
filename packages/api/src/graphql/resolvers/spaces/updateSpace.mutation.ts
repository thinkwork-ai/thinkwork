import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, spaces } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { parseSpaceAccessMode, toGraphqlSpace } from "./shared.js";

type UpdateSpaceInput = {
  tenantId: string;
  spaceId: string;
  name?: string | null;
  description?: string | null;
  accessMode?: string | null;
};

export async function updateSpace(
  _parent: unknown,
  args: { input: UpdateSpaceInput },
  ctx: GraphQLContext,
) {
  const input = args.input;
  await requireAdminOrServiceCaller(ctx, input.tenantId, "update_space");

  const updates: Record<string, unknown> = { updated_at: new Date() };

  if (input.name !== undefined && input.name !== null) {
    const name = input.name.trim();
    if (!name) throw new GraphQLError("Space name is required");
    updates.name = name;
  }

  if (input.description !== undefined) {
    updates.description = input.description?.trim() || null;
  }

  if (input.accessMode !== undefined) {
    const accessMode = parseSpaceAccessMode(input.accessMode);
    if (!accessMode) throw new GraphQLError("Invalid Space access mode");
    updates.access_mode = accessMode;
  }

  if (Object.keys(updates).length === 1) {
    throw new GraphQLError("No Space updates provided");
  }

  const [row] = await db
    .update(spaces)
    .set(updates)
    .where(
      and(eq(spaces.id, input.spaceId), eq(spaces.tenant_id, input.tenantId)),
    )
    .returning();

  if (!row) throw new GraphQLError("Space not found for tenant");

  return toGraphqlSpace(row);
}
