import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { listOntologyChangeSets } from "../../../lib/ontology/repository.js";
import { changeSetStatusFromGraphQL } from "./coercion.js";

export const ontologyChangeSets = async (
  _parent: unknown,
  args: { tenantId: string; status?: string | null },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "ontology_change_sets");
  return listOntologyChangeSets({
    tenantId: args.tenantId,
    status: changeSetStatusFromGraphQL(args.status),
  });
};
