import type { GraphQLContext } from "../../context.js";
import {
  isTenantAdmin,
  requireMemoryTenantScope,
  UserScopeAuthError,
} from "../core/require-user-scope.js";
import { hasSpaceMemberAccess } from "../spaces/shared.js";
import { promoteSpaceMemoriesToTenant as promote } from "../../../lib/memory/promotion.js";

/**
 * Governed Promotion (company-brain plan U10, KTD-8). Authorization gates
 * both ends: tenant operator (owner/admin) at the destination — the Tenant
 * Bank is readable by every member's agent — and source-space read access at
 * the origin, so operators promote only from spaces they can read.
 */
export const promoteSpaceMemoriesToTenant = async (
  _parent: unknown,
  args: {
    tenantId?: string | null;
    spaceId: string;
    memoryIds: string[];
    justification: string;
  },
  ctx: GraphQLContext,
) => {
  const { tenantId, userId } = await requireMemoryTenantScope(ctx, args);
  if (!userId) {
    throw new UserScopeAuthError(
      "Governed Promotion requires a user actor (service callers are not eligible)",
    );
  }
  if (!(await isTenantAdmin(userId, tenantId))) {
    throw new UserScopeAuthError(
      "Governed Promotion requires the tenant owner/admin role",
    );
  }
  if (!(await hasSpaceMemberAccess(ctx, tenantId, args.spaceId))) {
    throw new UserScopeAuthError(
      "Governed Promotion requires read access to the source space",
    );
  }
  return promote({
    tenantId,
    spaceId: args.spaceId,
    memoryIds: args.memoryIds ?? [],
    justification: args.justification ?? "",
    actorId: userId,
  });
};
