import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { listOntologyDefinitions } from "../../../lib/ontology/repository.js";

export const ontologyDefinitions = async (
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "ontology_definitions");
  return listOntologyDefinitions({ tenantId: args.tenantId });
};
