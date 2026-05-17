import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { rejectOntologyChangeSet } from "../../../lib/ontology/repository.js";

export const rejectOntologyChangeSetMutation = async (
  _parent: unknown,
  args: {
    input: { tenantId: string; changeSetId: string; reason?: string | null };
  },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.input.tenantId);
  const actorUserId = await resolveCallerUserId(ctx);
  return rejectOntologyChangeSet({
    tenantId: args.input.tenantId,
    changeSetId: args.input.changeSetId,
    reason: args.input.reason,
    actorUserId,
  });
};
