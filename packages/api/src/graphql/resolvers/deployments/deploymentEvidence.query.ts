import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  loadDeploymentJobForTenant,
  requireDeploymentTenantAdmin,
} from "./shared.js";

export async function deploymentEvidence(
  _parent: unknown,
  args: { jobId: string },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requireDeploymentTenantAdmin(ctx);
  const job = await loadDeploymentJobForTenant(tenantId, args.jobId);
  if (!job) {
    throw new GraphQLError("Deployment job not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  const bucket = job.evidence_bucket ?? null;
  const prefix = job.evidence_prefix ?? null;
  return {
    jobId: job.id,
    bucket,
    prefix,
    urls: bucket && prefix ? [`s3://${bucket}/${prefix}`] : [],
  };
}
