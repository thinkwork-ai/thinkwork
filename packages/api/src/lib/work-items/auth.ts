import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../graphql/context.js";
import { resolveCallerTenantId } from "../../graphql/resolvers/core/resolve-auth-user.js";
import { hasSpaceMemberAccess } from "../../graphql/resolvers/spaces/shared.js";

export async function resolveWorkItemTenant(
  ctx: GraphQLContext,
  requestedTenantId?: string | null,
) {
  const callerTenantId =
    ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
  const tenantId = requestedTenantId ?? callerTenantId;
  if (!tenantId) {
    throw new GraphQLError("Unable to resolve tenant for Work Items", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  if (
    ctx.auth?.authType === "cognito" &&
    callerTenantId &&
    tenantId !== callerTenantId
  ) {
    throw new GraphQLError("Not authorized for this tenant", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  return tenantId;
}

export async function requireWorkItemSpaceAccess(
  ctx: GraphQLContext,
  tenantId: string,
  spaceId: string,
) {
  if (!(await hasSpaceMemberAccess(ctx, tenantId, spaceId))) {
    throw new GraphQLError("Not authorized for this Work Item Space", {
      extensions: { code: "FORBIDDEN" },
    });
  }
}
