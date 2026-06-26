import type { GraphQLContext } from "../../context.js";
import {
  requireMemoryTenantScope,
  UserScopeAuthError,
} from "../core/require-user-scope.js";
import { hasSpaceMemberAccess } from "../spaces/shared.js";

export async function requireSpaceMemoryScope(
  ctx: GraphQLContext,
  args: { tenantId?: string | null; spaceId: string },
): Promise<{
  tenantId: string;
  spaceId: string;
  requesterUserId: string | null;
}> {
  const { tenantId, userId } = await requireMemoryTenantScope(ctx, args);
  const ok = await hasSpaceMemberAccess(ctx, tenantId, args.spaceId);
  if (!ok) {
    throw new UserScopeAuthError("Access denied: space mismatch");
  }
  return { tenantId, spaceId: args.spaceId, requesterUserId: userId };
}
