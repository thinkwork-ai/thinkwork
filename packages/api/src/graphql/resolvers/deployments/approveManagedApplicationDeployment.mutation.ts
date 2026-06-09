import { eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { managedApplicationDeploymentJobs } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import {
  appendJobEvent,
  buildManagedAppControllerPayload,
  defaultManifestUrl,
  defaultStartExecution,
  deploymentStateMachineArn,
  executionName,
  loadDeploymentJobForTenant,
  loadJobEvents,
  normalizeDeploymentOperation,
  normalizeManagedAppKey,
  requireDeploymentTenantAdmin,
  toDeploymentPayload,
  type DeploymentDeps,
} from "./shared.js";

export async function approveManagedApplicationDeployment(
  _parent: unknown,
  args: {
    input: {
      jobId: string;
      planDigest: string;
      manifestDigest: string;
      destructiveConfirmation?: string | null;
    };
  },
  ctx: GraphQLContext,
  deps: DeploymentDeps = {},
) {
  const { tenantId, callerUserId } = await requireDeploymentTenantAdmin(ctx);
  const job = await loadDeploymentJobForTenant(tenantId, args.input.jobId);
  if (!job) {
    throw new GraphQLError("Deployment job not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  if (job.status === "applying" || job.status === "succeeded") {
    const events = await loadJobEvents(tenantId, job.id);
    return toDeploymentPayload(job, events);
  }
  if (job.status !== "awaiting_approval") {
    throw new GraphQLError("Deployment job is not awaiting approval", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
  if (!job.plan_digest || job.plan_digest !== args.input.planDigest) {
    throw new GraphQLError("Deployment plan digest does not match", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
  if (job.manifest_digest !== args.input.manifestDigest) {
    throw new GraphQLError("Deployment manifest digest does not match", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
  if (
    isDestructive(job.data_impact) &&
    args.input.destructiveConfirmation !== "DESTROY"
  ) {
    throw new GraphQLError(
      "Destructive deployments require DESTROY confirmation",
      {
        extensions: { code: "FAILED_PRECONDITION" },
      },
    );
  }

  const stateMachineArn = job.state_machine_arn || deploymentStateMachineArn();
  if (!stateMachineArn) {
    throw new GraphQLError("Deployment state machine ARN is not configured", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }

  const [approved] = await db
    .update(managedApplicationDeploymentJobs)
    .set({
      status: "applying",
      approved_by_user_id: callerUserId,
      approved_at: new Date(),
      state_machine_arn: stateMachineArn,
      updated_at: new Date(),
    })
    .where(eq(managedApplicationDeploymentJobs.id, job.id))
    .returning();

  await appendJobEvent({
    tenantId,
    jobId: job.id,
    eventType: "deployment_approved",
    message: "Deployment job approved.",
    idempotencyKey: `${job.id}:approved`,
  });

  try {
    const planSummary = readPlanSummary(job.plan_summary);
    const started = await (deps.startExecution ?? defaultStartExecution)({
      stateMachineArn,
      name: executionName(job.id, "apply"),
      payload: buildManagedAppControllerPayload({
        phase: "apply",
        tenantId,
        jobId: job.id,
        appKey: normalizeManagedAppKey(job.app_key),
        operation: normalizeDeploymentOperation(job.operation),
        releaseVersion: job.release_version,
        manifestDigest: job.manifest_digest,
        releaseManifestUrl:
          planSummary.releaseManifestUrl ?? defaultManifestUrl(),
        desiredConfigVersion: job.desired_config_version,
        desiredConfig: planSummary.desiredConfig,
        manifestImages: planSummary.manifestImages,
        planDigest: job.plan_digest,
        evidenceBucket: job.evidence_bucket,
      }),
    });
    const [updated] = await db
      .update(managedApplicationDeploymentJobs)
      .set({
        apply_execution_arn: started.executionArn,
        updated_at: new Date(),
      })
      .where(eq(managedApplicationDeploymentJobs.id, job.id))
      .returning();
    await appendJobEvent({
      tenantId,
      jobId: job.id,
      eventType: "apply_execution_started",
      message: "Deployment apply execution started.",
      payload: { executionArn: started.executionArn },
      idempotencyKey: `${job.id}:apply-started`,
    });
    const events = await loadJobEvents(tenantId, job.id);
    return toDeploymentPayload(updated ?? approved ?? job, events);
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
      eventType: "apply_execution_failed",
      message: (err as Error).message,
      idempotencyKey: `${job.id}:apply-failed`,
    });
    const events = await loadJobEvents(tenantId, job.id);
    return toDeploymentPayload(failed ?? approved ?? job, events);
  }
}

function isDestructive(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { destructive?: unknown }).destructive === true
  );
}

function readPlanSummary(value: unknown): {
  releaseManifestUrl?: string;
  desiredConfig?: Record<string, unknown>;
  manifestImages?: Record<string, string>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const summary = value as Record<string, unknown>;
  return {
    releaseManifestUrl:
      typeof summary.releaseManifestUrl === "string"
        ? summary.releaseManifestUrl
        : undefined,
    desiredConfig:
      summary.desiredConfig &&
      typeof summary.desiredConfig === "object" &&
      !Array.isArray(summary.desiredConfig)
        ? (summary.desiredConfig as Record<string, unknown>)
        : undefined,
    manifestImages:
      summary.manifestImages &&
      typeof summary.manifestImages === "object" &&
      !Array.isArray(summary.manifestImages)
        ? Object.fromEntries(
            Object.entries(summary.manifestImages).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          )
        : undefined,
  };
}
