import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { loadOntologyReprocessJob } from "../../../lib/ontology/repository.js";

export const ontologyReprocessJob = async (
  _parent: unknown,
  args: { tenantId: string; jobId: string },
  ctx: GraphQLContext,
) => {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "ontology_reprocess_job");
  return loadOntologyReprocessJob({
    tenantId: args.tenantId,
    jobId: args.jobId,
  });
};
