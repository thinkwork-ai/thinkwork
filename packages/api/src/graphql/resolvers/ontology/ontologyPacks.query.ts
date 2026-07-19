import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { listOntologyPacks } from "../../../lib/ontology/packs.js";

/**
 * Installable seed-template bundles with per-type state (THINK-320 U3/R11).
 */
export const ontologyPacks = async (
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "ontology_packs");
  const packs = await listOntologyPacks({ tenantId: args.tenantId });
  return packs.map((pack) => ({
    ...pack,
    types: pack.types.map((type) => ({
      ...type,
      state: type.state.toUpperCase(),
    })),
  }));
};
