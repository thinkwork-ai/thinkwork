import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { updateOntologyEntityType } from "../../../lib/ontology/repository.js";
import { lifecycleStatusFromGraphQL } from "./coercion.js";

interface UpdateOntologyEntityTypeArgs {
  input: {
    tenantId: string;
    entityTypeId: string;
    name?: string | null;
    description?: string | null;
    broadType?: string | null;
    aliases?: string[] | null;
    guidanceNotes?: string | null;
    lifecycleStatus?: string | null;
  };
}

export const updateOntologyEntityTypeMutation = async (
  _parent: unknown,
  args: UpdateOntologyEntityTypeArgs,
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(ctx, args.input.tenantId, "update_ontology_entity_type");
  const actorUserId = await resolveCallerUserId(ctx);
  return updateOntologyEntityType({
    actorUserId,
    input: {
      ...args.input,
      lifecycleStatus: lifecycleStatusFromGraphQL(args.input.lifecycleStatus),
    },
  });
};
