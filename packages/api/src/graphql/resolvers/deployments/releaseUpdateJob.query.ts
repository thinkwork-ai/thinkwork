import type { GraphQLContext } from "../../context.js";
import {
  loadReleaseUpdateEvents,
  loadReleaseUpdateJobForTenant,
  requireDeploymentTenantAdmin,
  toReleaseUpdatePayload,
} from "./shared.js";

export async function releaseUpdateJob(
  _parent: unknown,
  args: { jobId: string },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requireDeploymentTenantAdmin(ctx);
  const job = await loadReleaseUpdateJobForTenant(tenantId, args.jobId);
  if (!job) return null;
  const events = await loadReleaseUpdateEvents(tenantId, job.id);
  return toReleaseUpdatePayload(job, events);
}
