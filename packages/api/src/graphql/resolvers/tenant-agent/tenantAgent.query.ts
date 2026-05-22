import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { loadTenantAgentForGraphql } from "./shared.js";

export async function tenantAgent(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "tenant_agent:read");
  return loadTenantAgentForGraphql(args.tenantId);
}
