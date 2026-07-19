import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { rejectOntologyChangeSetItem } from "../../../lib/ontology/repository.js";

/**
 * Item-level reject from the Living Map evidence panel (THINK-320 U6,
 * R13): rejects one still-reviewable item and writes its rejection
 * fingerprint without touching the owning change set's status.
 */
export const rejectOntologyChangeSetItemMutation = async (
  _parent: unknown,
  args: {
    input: { tenantId: string; itemId: string; reason?: string | null };
  },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(
    ctx,
    args.input.tenantId,
    "reject_ontology_change_set_item",
  );
  const actorUserId = await resolveCallerUserId(ctx);
  return rejectOntologyChangeSetItem({
    tenantId: args.input.tenantId,
    itemId: args.input.itemId,
    reason: args.input.reason,
    actorUserId,
  });
};
