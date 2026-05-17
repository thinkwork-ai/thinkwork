import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { loadOntologyReprocessJob } from "../../../lib/ontology/repository.js";

export const ontologyReprocessJob = async (
  _parent: unknown,
  args: { tenantId: string; jobId: string },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  return loadOntologyReprocessJob({
    tenantId: args.tenantId,
    jobId: args.jobId,
  });
};
