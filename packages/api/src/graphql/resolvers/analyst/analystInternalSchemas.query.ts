/**
 * analystInternalSchemas (THINK-283).
 *
 * Lists the selectable (non-system) schemas of one internal database with
 * eligible base-table counts and exact host/database/schema registration
 * coverage, so an operator selects exactly one schema intentionally. Requires
 * tenant owner/admin — same auth as analystInternalClusters. Discovery
 * failures the operator can correct (unknown cluster/database, unreachable
 * catalog) map to BAD_USER_INPUT.
 */

import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import {
  InternalSchemaDiscoveryError,
  listInternalSchemas,
  type InternalSchema,
} from "../../../lib/analyst/internal-clusters.js";

export const analystInternalSchemas = async (
  _parent: unknown,
  args: { clusterId: string; database: string },
  ctx: GraphQLContext,
): Promise<InternalSchema[]> => {
  const { tenantId } = await resolveCaller(ctx);
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  await requireTenantAdmin(ctx, tenantId);
  try {
    return await listInternalSchemas({
      tenantId,
      clusterId: args.clusterId,
      database: args.database,
    });
  } catch (err) {
    if (err instanceof InternalSchemaDiscoveryError) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    throw err;
  }
};
