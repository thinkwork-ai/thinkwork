import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { stageOntologyRelationshipTypeSourceBinding } from "../../../lib/ontology/repository.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { jsonValueFromGraphQL } from "./coercion.js";

interface SetSourceBindingArgs {
  tenantId?: string | null;
  relationshipTypeSlug: string;
  /** AWSJSON — { sourceSystem, sourceDataset, sourceKeyFields, targetKeyFields, note? }. */
  binding: unknown;
}

/**
 * Stage a twin edge source-binding edit (Company Brain U3 / R3).
 * Draft-only by construction: creates or merges a `relationship_binding`
 * change-set item — relationship_types.source_binding only changes when
 * the change set is approved and applied. An incomplete binding stages an
 * empty value, which clears the binding on apply.
 */
export const setOntologyRelationshipTypeSourceBindingMutation = async (
  _parent: unknown,
  args: SetSourceBindingArgs,
  ctx: GraphQLContext,
) => {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "set_ontology_relationship_type_source_binding",
  );
  const actorUserId = await resolveCallerUserId(ctx);
  const result = await stageOntologyRelationshipTypeSourceBinding({
    tenantId,
    relationshipTypeSlug: args.relationshipTypeSlug,
    binding: jsonValueFromGraphQL(args.binding),
    actorUserId,
  });
  return {
    changeSet: result.changeSet,
    mergedItemIds: result.mergedItemIds,
    conflicts: result.conflicts.map((conflict) => ({
      slug: conflict.slug,
      itemType: conflict.itemType.toUpperCase(),
      reason: conflict.reason,
    })),
  };
};
