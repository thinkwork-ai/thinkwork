import type { GraphQLContext } from "../../context.js";
import {
  loadDeploymentJobForTenant,
  loadJobEvents,
  requireDeploymentTenantAdmin,
  toDeploymentPayload,
} from "./shared.js";

export async function managedApplicationDeployment(
  _parent: unknown,
  args: { jobId: string },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requireDeploymentTenantAdmin(ctx);
  const job = await loadDeploymentJobForTenant(tenantId, args.jobId);
  if (!job) return null;
  const events = await loadJobEvents(tenantId, job.id);
  return toDeploymentPayload(job, events);
}
