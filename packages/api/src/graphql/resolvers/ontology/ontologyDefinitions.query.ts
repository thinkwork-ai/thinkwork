import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { listOntologyDefinitions } from "../../../lib/ontology/repository.js";

export const ontologyDefinitions = async (
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  return listOntologyDefinitions({ tenantId: args.tenantId });
};
