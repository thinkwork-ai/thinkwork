import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { loadOntologySuggestionScanJob } from "../../../lib/ontology/repository.js";

export const ontologySuggestionScanJob = async (
  _parent: unknown,
  args: { tenantId: string; jobId: string },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "ontology_suggestion_scan_job");
  return loadOntologySuggestionScanJob({
    tenantId: args.tenantId,
    jobId: args.jobId,
  });
};
