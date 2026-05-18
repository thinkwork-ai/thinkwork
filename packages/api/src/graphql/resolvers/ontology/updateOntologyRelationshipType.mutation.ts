import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { updateOntologyRelationshipType } from "../../../lib/ontology/repository.js";
import { lifecycleStatusFromGraphQL } from "./coercion.js";

interface UpdateOntologyRelationshipTypeArgs {
  input: {
    tenantId: string;
    relationshipTypeId: string;
    name?: string | null;
    description?: string | null;
    inverseName?: string | null;
    sourceTypeSlugs?: string[] | null;
    targetTypeSlugs?: string[] | null;
    aliases?: string[] | null;
    guidanceNotes?: string | null;
    lifecycleStatus?: string | null;
  };
}

export const updateOntologyRelationshipTypeMutation = async (
  _parent: unknown,
  args: UpdateOntologyRelationshipTypeArgs,
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(ctx, args.input.tenantId, "update_ontology_relationship_type");
  const actorUserId = await resolveCallerUserId(ctx);
  return updateOntologyRelationshipType({
    actorUserId,
    input: {
      ...args.input,
      lifecycleStatus: lifecycleStatusFromGraphQL(args.input.lifecycleStatus),
    },
  });
};
