/**
 * analystInternalClusters (THINK-239).
 *
 * Lists the environment's own RDS clusters + databases so an operator can
 * register one as an analyst data source with zero credential entry. Requires
 * tenant owner/admin — same auth as registerAnalystDataSource.
 */

import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import {
  listInternalClusters,
  type InternalCluster,
} from "../../../lib/analyst/internal-clusters.js";

export const analystInternalClusters = async (
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
): Promise<InternalCluster[]> => {
  const { tenantId } = await resolveCaller(ctx);
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  await requireTenantAdmin(ctx, tenantId);
  return listInternalClusters({ tenantId });
};
