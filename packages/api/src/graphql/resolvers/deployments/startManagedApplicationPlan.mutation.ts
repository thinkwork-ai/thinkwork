import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import {
  managedApplicationDeploymentJobs,
  managedApplications,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import {
  appendJobEvent,
  dataImpactFor,
  defaultManifestDigest,
  defaultReleaseVersion,
  defaultStartExecution,
  deploymentEvidenceBucket,
  deploymentStateMachineArn,
  desiredStatusFor,
  ensureManagedApplication,
  executionName,
  loadJobEvents,
  normalizeDeploymentOperation,
  normalizeManagedAppKey,
  parseAwsJsonObject,
  requireDeploymentTenantAdmin,
  toDeploymentPayload,
  type DeploymentDeps,
} from "./shared.js";

export async function startManagedApplicationPlan(
  _parent: unknown,
  args: { input: Record<string, unknown> },
  ctx: GraphQLContext,
  deps: DeploymentDeps = {},
) {
  const { tenantId, callerUserId } = await requireDeploymentTenantAdmin(ctx);
  const appKey = normalizeManagedAppKey(args.input.key);
  const operation = normalizeDeploymentOperation(args.input.operation);
  const idempotencyKey = String(args.input.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    throw new GraphQLError("idempotencyKey is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const [existing] = await db
    .select()
    .from(managedApplicationDeploymentJobs)
    .where(
      and(
        eq(managedApplicationDeploymentJobs.tenant_id, tenantId),
        eq(managedApplicationDeploymentJobs.idempotency_key, idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) {
    const events = await loadJobEvents(tenantId, existing.id);
    return toDeploymentPayload(existing, events);
  }

  const releaseVersion =
    typeof args.input.releaseVersion === "string" && args.input.releaseVersion
      ? args.input.releaseVersion
      : defaultReleaseVersion();
  const manifestDigest =
    typeof args.input.manifestDigest === "string" && args.input.manifestDigest
      ? args.input.manifestDigest
      : defaultManifestDigest();
  const desiredConfigVersion =
    typeof args.input.desiredConfigVersion === "string" &&
    args.input.desiredConfigVersion
      ? args.input.desiredConfigVersion
      : "v1";
  const desiredConfig = parseAwsJsonObject(args.input.desiredConfig);

  const application = await ensureManagedApplication({
    tenantId,
    key: appKey,
    desiredStatus: desiredStatusFor(operation),
    desiredConfig,
    releaseVersion,
    manifestDigest,
  });
  const stateMachineArn = deploymentStateMachineArn();
  const evidenceBucket = deploymentEvidenceBucket();
  const jobId = randomUUID();
  const [job] = await db
    .insert(managedApplicationDeploymentJobs)
    .values({
      id: jobId,
      tenant_id: tenantId,
      application_id: application.id,
      app_key: appKey,
      operation,
      status: "planning",
      idempotency_key: idempotencyKey,
      requested_by_user_id: callerUserId,
      release_version: releaseVersion,
      manifest_digest: manifestDigest,
      desired_config_version: desiredConfigVersion,
      state_machine_arn: stateMachineArn,
      plan_summary: {
        appKey,
        operation,
        releaseVersion,
        manifestDigest,
      },
      data_impact: dataImpactFor(appKey, operation),
      evidence_bucket: evidenceBucket,
      evidence_prefix: evidenceBucket
        ? `${tenantId}/${appKey}/${jobId}/plan`
        : null,
    })
    .returning();

  await appendJobEvent({
    tenantId,
    jobId: job.id,
    eventType: "plan_requested",
    message: `Plan requested for ${appKey} ${operation}.`,
    idempotencyKey: `${idempotencyKey}:requested`,
  });

  await db
    .update(managedApplications)
    .set({ last_job_id: job.id, updated_at: new Date() })
    .where(eq(managedApplications.id, application.id));

  if (!stateMachineArn) {
    await appendJobEvent({
      tenantId,
      jobId: job.id,
      eventType: "plan_pending_runner",
      message: "Deployment state machine ARN is not configured yet.",
      idempotencyKey: `${idempotencyKey}:pending-runner`,
    });
    const events = await loadJobEvents(tenantId, job.id);
    return toDeploymentPayload(job, events);
  }

  try {
    const started = await (deps.startExecution ?? defaultStartExecution)({
      stateMachineArn,
      name: executionName(job.id, "plan"),
      payload: {
        phase: "plan",
        tenantId,
        jobId: job.id,
        appKey,
        operation,
        releaseVersion,
        manifestDigest,
        desiredConfigVersion,
        desiredConfig,
      },
    });
    const [updated] = await db
      .update(managedApplicationDeploymentJobs)
      .set({
        plan_execution_arn: started.executionArn,
        updated_at: new Date(),
      })
      .where(eq(managedApplicationDeploymentJobs.id, job.id))
      .returning();
    await appendJobEvent({
      tenantId,
      jobId: job.id,
      eventType: "plan_execution_started",
      message: "Deployment plan execution started.",
      payload: { executionArn: started.executionArn },
      idempotencyKey: `${idempotencyKey}:plan-started`,
    });
    const events = await loadJobEvents(tenantId, job.id);
    return toDeploymentPayload(updated ?? job, events);
  } catch (err) {
    const [failed] = await db
      .update(managedApplicationDeploymentJobs)
      .set({
        status: "failed",
        error_message: (err as Error).message,
        updated_at: new Date(),
      })
      .where(eq(managedApplicationDeploymentJobs.id, job.id))
      .returning();
    await appendJobEvent({
      tenantId,
      jobId: job.id,
      eventType: "plan_execution_failed",
      message: (err as Error).message,
      idempotencyKey: `${idempotencyKey}:plan-failed`,
    });
    const events = await loadJobEvents(tenantId, job.id);
    return toDeploymentPayload(failed ?? job, events);
  }
}
