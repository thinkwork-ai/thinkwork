import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { startOntologySuggestionScanJob } from "../../../lib/ontology/suggestions.js";

export const startOntologySuggestionScanMutation = async (
  _parent: unknown,
  args: {
    input: {
      tenantId: string;
      trigger?: string | null;
      dedupeKey?: string | null;
    };
  },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.input.tenantId);
  return startOntologySuggestionScanJob({
    tenantId: args.input.tenantId,
    trigger: args.input.trigger,
    dedupeKey: args.input.dedupeKey,
  });
};
