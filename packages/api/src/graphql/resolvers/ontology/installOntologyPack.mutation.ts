import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { installOntologyPack } from "../../../lib/ontology/packs.js";

interface InstallOntologyPackArgs {
  input: {
    tenantId: string;
    packSlug: string;
  };
}

/**
 * Stage a seed-template pack for review (THINK-320 U3/R11, AE4/AE6):
 * persists through the governed pack_install proposal path — collisions
 * merge or conflict, rejected fingerprints are skipped.
 */
export const installOntologyPackMutation = async (
  _parent: unknown,
  args: InstallOntologyPackArgs,
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(
    ctx,
    args.input.tenantId,
    "install_ontology_pack",
  );
  const result = await installOntologyPack({
    tenantId: args.input.tenantId,
    packSlug: args.input.packSlug,
  });
  return {
    changeSet: result.changeSet,
    mergedItemIds: result.mergedItemIds,
    conflicts: result.conflicts.map((conflict) => ({
      slug: conflict.slug,
      itemType: conflict.itemType.toUpperCase(),
      reason: conflict.reason,
    })),
    skippedRejectedSlugs: result.skippedRejectedSlugs,
  };
};
