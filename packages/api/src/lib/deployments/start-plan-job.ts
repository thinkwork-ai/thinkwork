/**
 * Shared managed-application plan-job creation (plan 2026-06-12-001 U11).
 *
 * This is the EXACT core of the `startManagedApplicationPlan` mutation,
 * extracted so the plugin infrastructure component handler creates
 * deployment jobs through the SAME code path the resolver uses — same
 * idempotency-key dedupe, `ensureManagedApplication` upsert, job/event
 * rows, Step Function kick, and failure handling. The resolver keeps
 * auth + GraphQL input parsing and delegates here; jobs created by either
 * caller are indistinguishable, so the existing approve/reject mutations
 * gate plugin-created jobs with no new approval surface.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  managedApplicationDeploymentJobs,
  managedApplications,
} from "@thinkwork/database-pg/schema";
import type { ManagedAppKey } from "@thinkwork/deployment-runner/apps/registry";
import { db } from "../../graphql/utils.js";
import {
  appendJobEvent,
  buildManagedAppControllerPayload,
  dataImpactFor,
  defaultManifestDigest,
  defaultManifestUrl,
  defaultReleaseVersion,
  defaultStartExecution,
  deploymentEvidenceBucket,
  deploymentStateMachineArn,
  desiredStatusFor,
  ensureManagedApplication,
  executionName,
  loadJobEvents,
  managedAppEvidencePrefix,
  type DeploymentDeps,
  type DeploymentOperation,
} from "../../graphql/resolvers/deployments/shared.js";

export type ManagedApplicationDeploymentJobRow =
  typeof managedApplicationDeploymentJobs.$inferSelect;

export interface StartManagedApplicationPlanJobArgs {
  tenantId: string;
  requestedByUserId: string | null;
  appKey: ManagedAppKey;
  operation: DeploymentOperation;
  idempotencyKey: string;
  releaseVersion?: string | null;
  manifestDigest?: string | null;
  releaseManifestUrl?: string | null;
  desiredConfigVersion?: string | null;
  desiredConfig?: Record<string, unknown>;
  manifestImages?: Record<string, string>;
}

export interface StartedManagedApplicationPlanJob {
  job: ManagedApplicationDeploymentJobRow;
  events: unknown[];
}

export async function startManagedApplicationPlanJob(
  args: StartManagedApplicationPlanJobArgs,
  deps: DeploymentDeps = {},
): Promise<StartedManagedApplicationPlanJob> {
  const { tenantId, requestedByUserId, appKey, operation, idempotencyKey } =
    args;

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
    return { job: existing, events };
  }

  const releaseVersion = args.releaseVersion || defaultReleaseVersion();
  const manifestDigest = args.manifestDigest || defaultManifestDigest();
  const releaseManifestUrl = args.releaseManifestUrl || defaultManifestUrl();

  // Guard: never create a deploy job with the "unresolved" sentinel. The
  // deployment Step Function fails at launch on the missing
  // releaseManifestSha256 and nothing writes that failure back, so the job
  // would wedge in `planning` forever. ENABLE/UPGRADE/DESTROY all need a
  // real release; callers (incl. the plugin infra handler — see Fix B) must
  // resolve one or fail closed before reaching here.
  if (releaseVersion === "unresolved" || manifestDigest === "unresolved") {
    throw new Error(
      `Cannot start a ${operation} deployment job for ${appKey}: release is ` +
        `unresolved (releaseVersion="${releaseVersion}", ` +
        `manifestDigest="${manifestDigest}"). Resolve a real release before ` +
        `creating the job.`,
    );
  }
  const desiredConfigVersion = args.desiredConfigVersion || "v1";
  const desiredConfig = args.desiredConfig ?? {};
  const manifestImages = args.manifestImages ?? {};

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
      requested_by_user_id: requestedByUserId,
      release_version: releaseVersion,
      manifest_digest: manifestDigest,
      desired_config_version: desiredConfigVersion,
      state_machine_arn: stateMachineArn,
      plan_summary: {
        appKey,
        operation,
        releaseVersion,
        manifestDigest,
        releaseManifestUrl,
        desiredConfig,
        manifestImages,
      },
      data_impact: dataImpactFor(appKey, operation),
      evidence_bucket: evidenceBucket,
      evidence_prefix: evidenceBucket
        ? managedAppEvidencePrefix({ tenantId, appKey, jobId, phase: "plan" })
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
    return { job, events };
  }

  try {
    const started = await (deps.startExecution ?? defaultStartExecution)({
      stateMachineArn,
      name: executionName(job.id, "plan"),
      payload: buildManagedAppControllerPayload({
        phase: "plan",
        tenantId,
        jobId: job.id,
        appKey,
        operation,
        releaseVersion,
        manifestDigest,
        releaseManifestUrl,
        desiredConfigVersion,
        desiredConfig,
        manifestImages,
        evidenceBucket,
      }),
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
    return { job: updated ?? job, events };
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
    return { job: failed ?? job, events };
  }
}
