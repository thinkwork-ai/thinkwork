import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { loadOntologySuggestionScanJob } from "../../../lib/ontology/repository.js";

export const ontologySuggestionScanJob = async (
  _parent: unknown,
  args: { tenantId: string; jobId: string },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  return loadOntologySuggestionScanJob({
    tenantId: args.tenantId,
    jobId: args.jobId,
  });
};
