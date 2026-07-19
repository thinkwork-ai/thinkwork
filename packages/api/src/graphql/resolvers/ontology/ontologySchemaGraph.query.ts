import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { getOntologySchemaGraph } from "../../../lib/ontology/repository.js";

export const ontologySchemaGraph = async (
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "ontology_schema_graph",
  );
  return getOntologySchemaGraph({ tenantId: args.tenantId });
};
