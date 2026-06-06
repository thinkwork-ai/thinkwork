import { eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { managedApplicationDeploymentJobs } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import {
  appendJobEvent,
  loadDeploymentJobForTenant,
  loadJobEvents,
  requireDeploymentTenantAdmin,
  toDeploymentPayload,
} from "./shared.js";

export async function rejectManagedApplicationDeployment(
  _parent: unknown,
  args: { input: { jobId: string; reason?: string | null } },
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requireDeploymentTenantAdmin(ctx);
  const job = await loadDeploymentJobForTenant(tenantId, args.input.jobId);
  if (!job) {
    throw new GraphQLError("Deployment job not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  if (job.status === "rejected") {
    const events = await loadJobEvents(tenantId, job.id);
    return toDeploymentPayload(job, events);
  }
  if (job.status !== "awaiting_approval") {
    throw new GraphQLError("Deployment job is not awaiting approval", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }

  const reason = args.input.reason?.trim() || "Deployment plan rejected.";
  const [rejected] = await db
    .update(managedApplicationDeploymentJobs)
    .set({
      status: "rejected",
      rejected_by_user_id: callerUserId,
      rejected_at: new Date(),
      error_message: reason,
      updated_at: new Date(),
    })
    .where(eq(managedApplicationDeploymentJobs.id, job.id))
    .returning();

  await appendJobEvent({
    tenantId,
    jobId: job.id,
    eventType: "deployment_rejected",
    message: reason,
    idempotencyKey: `${job.id}:rejected`,
  });

  const events = await loadJobEvents(tenantId, job.id);
  return toDeploymentPayload(rejected ?? job, events);
}
