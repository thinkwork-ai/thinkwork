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
  assertResolvedRelease,
  buildManagedAppControllerPayload,
  dataImpactFor,
  defaultStartExecution,
  desiredStatusFor,
  ensureManagedApplication,
  executionName,
  loadJobEvents,
  managedAppEvidencePrefix,
  resolveDeploymentControllerConfig,
  resolveDefaultReleaseMetadata,
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
    if (existing.status === "planning" && !existing.plan_execution_arn) {
      const started = await startPendingPlanExecution(existing, deps);
      if (started) return started;
    }
    const events = await loadJobEvents(tenantId, existing.id);
    return { job: existing, events };
  }

  const releaseDefaults =
    args.releaseVersion === null ||
    args.releaseVersion === undefined ||
    args.manifestDigest === null ||
    args.manifestDigest === undefined
      ? await resolveDefaultReleaseMetadata()
      : {
          releaseVersion: null,
          manifestDigest: null,
          releaseManifestUrl: null,
        };
  const { releaseVersion, manifestDigest, releaseManifestUrl } =
    assertResolvedRelease({
      appKey,
      operation,
      releaseVersion: args.releaseVersion ?? releaseDefaults.releaseVersion,
      manifestDigest: args.manifestDigest ?? releaseDefaults.manifestDigest,
      releaseManifestUrl:
        args.releaseManifestUrl ?? releaseDefaults.releaseManifestUrl,
    });
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
  const controllerConfig = await resolveControllerConfig(deps);
  const stateMachineArn = controllerConfig.stateMachineArn;
  const evidenceBucket = controllerConfig.evidenceBucket;
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
    return await startPlanExecution({
      job,
      tenantId,
      appKey,
      operation,
      releaseVersion,
      manifestDigest,
      releaseManifestUrl,
      desiredConfigVersion,
      desiredConfig,
      manifestImages,
      stateMachineArn,
      evidenceBucket,
      idempotencyKey: `${idempotencyKey}:plan-started`,
      deps,
    });
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

async function startPendingPlanExecution(
  job: ManagedApplicationDeploymentJobRow,
  deps: DeploymentDeps,
): Promise<StartedManagedApplicationPlanJob | null> {
  const controllerConfig = await resolveControllerConfig(deps);
  if (!controllerConfig.stateMachineArn) return null;

  const planSummary = readPlanSummary(job.plan_summary);
  const appKey = job.app_key as ManagedAppKey;
  const operation = job.operation as DeploymentOperation;
  const desiredConfigVersion = job.desired_config_version || "v1";
  const evidenceBucket = job.evidence_bucket ?? controllerConfig.evidenceBucket;

  return startPlanExecution({
    job,
    tenantId: job.tenant_id,
    appKey,
    operation,
    releaseVersion: job.release_version,
    manifestDigest: job.manifest_digest,
    releaseManifestUrl: planSummary.releaseManifestUrl,
    desiredConfigVersion,
    desiredConfig: planSummary.desiredConfig,
    manifestImages: planSummary.manifestImages,
    stateMachineArn: controllerConfig.stateMachineArn,
    evidenceBucket,
    idempotencyKey: `${job.id}:plan-started`,
    deps,
  });
}

async function startPlanExecution(args: {
  job: ManagedApplicationDeploymentJobRow;
  tenantId: string;
  appKey: ManagedAppKey;
  operation: DeploymentOperation;
  releaseVersion: string;
  manifestDigest: string;
  releaseManifestUrl?: string | null;
  desiredConfigVersion: string;
  desiredConfig: Record<string, unknown>;
  manifestImages: Record<string, string>;
  stateMachineArn: string;
  evidenceBucket: string | null;
  idempotencyKey: string;
  deps: DeploymentDeps;
}): Promise<StartedManagedApplicationPlanJob> {
  const started = await (args.deps.startExecution ?? defaultStartExecution)({
    stateMachineArn: args.stateMachineArn,
    name: executionName(args.job.id, "plan"),
    payload: buildManagedAppControllerPayload({
      phase: "plan",
      tenantId: args.tenantId,
      jobId: args.job.id,
      appKey: args.appKey,
      operation: args.operation,
      releaseVersion: args.releaseVersion,
      manifestDigest: args.manifestDigest,
      releaseManifestUrl: args.releaseManifestUrl,
      desiredConfigVersion: args.desiredConfigVersion,
      desiredConfig: args.desiredConfig,
      manifestImages: args.manifestImages,
      evidenceBucket: args.evidenceBucket,
    }),
  });
  const evidencePrefix = args.evidenceBucket
    ? managedAppEvidencePrefix({
        tenantId: args.tenantId,
        appKey: args.appKey,
        jobId: args.job.id,
        phase: "plan",
      })
    : null;
  const [updated] = await db
    .update(managedApplicationDeploymentJobs)
    .set({
      state_machine_arn: args.stateMachineArn,
      plan_execution_arn: started.executionArn,
      evidence_bucket: args.evidenceBucket,
      evidence_prefix: evidencePrefix,
      updated_at: new Date(),
    })
    .where(eq(managedApplicationDeploymentJobs.id, args.job.id))
    .returning();
  await appendJobEvent({
    tenantId: args.tenantId,
    jobId: args.job.id,
    eventType: "plan_execution_started",
    message: "Deployment plan execution started.",
    payload: { executionArn: started.executionArn },
    idempotencyKey: args.idempotencyKey,
  });
  const events = await loadJobEvents(args.tenantId, args.job.id);
  return { job: updated ?? args.job, events };
}

function readPlanSummary(value: unknown): {
  releaseManifestUrl?: string | null;
  desiredConfig: Record<string, unknown>;
  manifestImages: Record<string, string>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { desiredConfig: {}, manifestImages: {} };
  }
  const summary = value as Record<string, unknown>;
  return {
    releaseManifestUrl:
      typeof summary.releaseManifestUrl === "string"
        ? summary.releaseManifestUrl
        : null,
    desiredConfig: recordField(summary.desiredConfig),
    manifestImages: stringRecordField(summary.manifestImages),
  };
}

function recordField(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringRecordField(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(recordField(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function resolveControllerConfig(deps: DeploymentDeps) {
  return (
    deps.resolveDeploymentControllerConfig ?? resolveDeploymentControllerConfig
  )();
}
