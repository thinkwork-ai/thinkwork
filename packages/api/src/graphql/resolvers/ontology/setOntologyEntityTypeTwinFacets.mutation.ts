import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { stageOntologyEntityTypeTwinFacets } from "../../../lib/ontology/repository.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { jsonValueFromGraphQL } from "./coercion.js";

interface SetTwinFacetsArgs {
  tenantId?: string | null;
  entityTypeSlug: string;
  /** AWSJSON — array of twin facet declarations; malformed entries drop on parse. */
  facets: unknown;
}

/**
 * Stage a twin facet-declaration edit (Company Brain U3 / R2, R4).
 * Draft-only by construction: this creates or merges a `facet_declaration`
 * change-set item — entity_types.twin_facets is never written here, only
 * by the change-set apply path after approval (which also regenerates the
 * compiled twin mapping export, KTD-3).
 */
export const setOntologyEntityTypeTwinFacetsMutation = async (
  _parent: unknown,
  args: SetTwinFacetsArgs,
  ctx: GraphQLContext,
) => {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "set_ontology_entity_type_twin_facets",
  );
  const actorUserId = await resolveCallerUserId(ctx);
  const result = await stageOntologyEntityTypeTwinFacets({
    tenantId,
    entityTypeSlug: args.entityTypeSlug,
    facets: jsonValueFromGraphQL(args.facets),
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
