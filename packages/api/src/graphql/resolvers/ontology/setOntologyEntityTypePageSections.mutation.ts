import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { stageOntologyEntityTypePageSections } from "../../../lib/ontology/repository.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { jsonValueFromGraphQL } from "./coercion.js";

interface SetPageSectionsArgs {
  tenantId?: string | null;
  entityTypeSlug: string;
  /** AWSJSON — array of page-section declarations; malformed entries drop on parse. */
  sections: unknown;
}

/**
 * Stage an entity-page section-declaration edit (Company Brain U3 / R10,
 * R14). Draft-only by construction: creates or merges a `page_section`
 * change-set item — entity_types.page_sections only changes when the
 * change set is approved and applied.
 */
export const setOntologyEntityTypePageSectionsMutation = async (
  _parent: unknown,
  args: SetPageSectionsArgs,
  ctx: GraphQLContext,
) => {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "set_ontology_entity_type_page_sections",
  );
  const actorUserId = await resolveCallerUserId(ctx);
  const result = await stageOntologyEntityTypePageSections({
    tenantId,
    entityTypeSlug: args.entityTypeSlug,
    sections: jsonValueFromGraphQL(args.sections),
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
