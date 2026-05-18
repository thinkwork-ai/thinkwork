import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { approveOntologyChangeSet } from "../../../lib/ontology/repository.js";

export const approveOntologyChangeSetMutation = async (
  _parent: unknown,
  args: { input: { tenantId: string; changeSetId: string } },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(ctx, args.input.tenantId, "approve_ontology_change_set");
  const actorUserId = await resolveCallerUserId(ctx);
  return approveOntologyChangeSet({
    tenantId: args.input.tenantId,
    changeSetId: args.input.changeSetId,
    actorUserId,
  });
};
