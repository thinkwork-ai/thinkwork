import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
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
  await requireTenantAdmin(ctx, args.input.tenantId);
  const actorUserId = await resolveCallerUserId(ctx);
  return updateOntologyEntityType({
    actorUserId,
    input: {
      ...args.input,
      lifecycleStatus: lifecycleStatusFromGraphQL(args.input.lifecycleStatus),
    },
  });
};
