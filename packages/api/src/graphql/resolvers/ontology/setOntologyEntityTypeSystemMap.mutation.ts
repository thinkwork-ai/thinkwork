import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { stageOntologyEntityTypeSystemMap } from "../../../lib/ontology/repository.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { jsonValueFromGraphQL } from "./coercion.js";

interface SetSystemMapArgs {
  tenantId?: string | null;
  entityTypeSlug: string;
  /** AWSJSON — array of { facet, sourceSystem, note? }; malformed entries drop on parse. */
  systemMap: unknown;
}

/**
 * Stage a type-level system-map edit (THINK-321 U3 / R6). Draft-only by
 * construction: this creates or merges an `identity_map` change-set item —
 * entity_types.system_map is never written here, only by the change-set
 * apply path after approval.
 */
export const setOntologyEntityTypeSystemMapMutation = async (
  _parent: unknown,
  args: SetSystemMapArgs,
  ctx: GraphQLContext,
) => {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "set_ontology_entity_type_system_map",
  );
  const actorUserId = await resolveCallerUserId(ctx);
  const result = await stageOntologyEntityTypeSystemMap({
    tenantId,
    entityTypeSlug: args.entityTypeSlug,
    systemMap: jsonValueFromGraphQL(args.systemMap),
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
