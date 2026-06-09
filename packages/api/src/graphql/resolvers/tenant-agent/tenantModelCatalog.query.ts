import type { GraphQLContext } from "../../context.js";
import { listTenantModelCatalog } from "../../../lib/model-catalog/tenant-catalog.js";
import { requireTenantAdmin } from "../core/authz.js";

export async function tenantModelCatalog(
  _parent: unknown,
  args: { tenantId: string; includeDisabled?: boolean | null },
  ctx: GraphQLContext,
) {
  await requireTenantAdmin(ctx, args.tenantId);
  return listTenantModelCatalog({
    tenantId: args.tenantId,
    includeDisabled: args.includeDisabled ?? true,
  });
}
