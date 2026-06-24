import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import {
  managedApplicationDeploymentEvents,
  managedApplicationDeploymentJobs,
  managedApplications,
} from "@thinkwork/database-pg/schema";
import {
  getManagedAppAdapter,
  type ManagedAppKey,
} from "@thinkwork/deployment-runner/apps/registry";
import { db as defaultDb } from "../../graphql/utils.js";

type DbLike = typeof defaultDb;
type DeploymentJob = typeof managedApplicationDeploymentJobs.$inferSelect;

const s3 = new S3Client({});

export async function reconcileManagedApplicationDeploymentJobFromEvidence(
  tenantId: string,
  job: DeploymentJob,
  db: DbLike = defaultDb,
): Promise<DeploymentJob> {
  if (job.status !== "planning" && job.status !== "applying") return job;
  if (!job.evidence_bucket) return job;

  const phase = job.status === "planning" ? "plan" : "apply";
  const evidence = await readFirstEvidenceJson(
    job.evidence_bucket,
    evidenceKeys({ tenantId, job, phase }),
  );
  if (!evidence) return job;

  const evidenceStatus = stringField(evidence, "status");
  if (!evidenceStatus || evidenceStatus === "running") return job;

  const codebuildBuildId = stringField(evidence, "codebuildBuildId");
  const terraformExitCode = numberField(evidence, "terraformExitCode");
  if (evidenceStatus === "failed" || failedExitCode(terraformExitCode)) {
    return markJobFailed({
      tenantId,
      job,
      phase,
      db,
      codebuildBuildId,
      message:
        stringField(evidence, "error") ??
        `Deployment ${phase} failed in the runner.`,
    });
  }
  if (evidenceStatus !== "succeeded") return job;

  if (phase === "plan") {
    const planDigest = nestedString(evidence, [
      "terraform",
      "plan",
      "artifact",
      "sha256",
    ]);
    if (!planDigest) {
      return markJobFailed({
        tenantId,
        job,
        phase,
        db,
        codebuildBuildId,
        message: "Deployment plan evidence is missing a Terraform plan digest.",
      });
    }
    return markPlanAwaitingApproval({
      tenantId,
      job,
      db,
      evidence,
      codebuildBuildId,
      planDigest,
    });
  }

  return markApplySucceeded({
    tenantId,
    job,
    db,
    evidence,
    codebuildBuildId,
  });
}

async function markPlanAwaitingApproval(args: {
  tenantId: string;
  job: DeploymentJob;
  db: DbLike;
  evidence: Record<string, unknown>;
  codebuildBuildId: string | null;
  planDigest: string;
}): Promise<DeploymentJob> {
  const planSummary =
    args.job.plan_summary &&
    typeof args.job.plan_summary === "object" &&
    !Array.isArray(args.job.plan_summary)
      ? { ...(args.job.plan_summary as Record<string, unknown>) }
      : {};
  planSummary.terraform = {
    ...(typeof planSummary.terraform === "object" &&
    planSummary.terraform !== null &&
    !Array.isArray(planSummary.terraform)
      ? (planSummary.terraform as Record<string, unknown>)
      : {}),
    plan: nestedRecord(args.evidence, ["terraform", "plan", "summary"]),
  };

  const [updated] = await args.db
    .update(managedApplicationDeploymentJobs)
    .set({
      status: "awaiting_approval",
      codebuild_build_arn: args.codebuildBuildId,
      plan_digest: args.planDigest,
      plan_summary: planSummary,
      error_message: null,
      updated_at: new Date(),
    })
    .where(eq(managedApplicationDeploymentJobs.id, args.job.id))
    .returning();

  await appendEvidenceEvent({
    tenantId: args.tenantId,
    jobId: args.job.id,
    db: args.db,
    eventType: "plan_evidence_reconciled",
    message: "Deployment plan evidence reconciled; approval is required.",
    payload: { planDigest: args.planDigest },
  });

  return updated ?? args.job;
}

async function markApplySucceeded(args: {
  tenantId: string;
  job: DeploymentJob;
  db: DbLike;
  evidence: Record<string, unknown>;
  codebuildBuildId: string | null;
}): Promise<DeploymentJob> {
  const terraformOutputs = await readTerraformOutputs(args.evidence);
  const desiredConfigPatch = desiredConfigPatchFromTerraformOutputs(
    args.job.app_key,
    terraformOutputs,
  );
  const [updated] = await args.db
    .update(managedApplicationDeploymentJobs)
    .set({
      status: "succeeded",
      codebuild_build_arn: args.codebuildBuildId,
      error_message: null,
      updated_at: new Date(),
    })
    .where(eq(managedApplicationDeploymentJobs.id, args.job.id))
    .returning();

  if (args.job.application_id) {
    const desiredConfigUpdate =
      Object.keys(desiredConfigPatch).length > 0
        ? {
            desired_config: {
              ...(await readManagedApplicationDesiredConfig(
                args.db,
                args.job.application_id,
              )),
              ...desiredConfigPatch,
            },
          }
        : {};
    await args.db
      .update(managedApplications)
      .set({
        current_status: currentStatusFromTerraformOutputs(
          args.job.app_key,
          args.job.operation,
          terraformOutputs,
        ),
        ...desiredConfigUpdate,
        updated_at: new Date(),
      })
      .where(eq(managedApplications.id, args.job.application_id))
      .returning();
  }

  await appendEvidenceEvent({
    tenantId: args.tenantId,
    jobId: args.job.id,
    db: args.db,
    eventType: "apply_evidence_reconciled",
    message: "Deployment apply evidence reconciled.",
    payload: {
      status: "succeeded",
      outputs: nestedRecord(args.evidence, ["terraform", "outputs"]),
    },
  });

  return updated ?? args.job;
}

async function readTerraformOutputs(
  evidence: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const outputArtifactUri = nestedString(evidence, [
    "terraform",
    "outputs",
    "s3Uri",
  ]);
  if (outputArtifactUri) {
    const location = parseS3Uri(outputArtifactUri);
    if (location) {
      return (await readEvidenceJson(location.bucket, location.key)) ?? {};
    }
  }
  return nestedRecord(evidence, ["terraform", "outputs"]);
}

async function readManagedApplicationDesiredConfig(
  db: DbLike,
  applicationId: string,
): Promise<Record<string, unknown>> {
  const [row] = (await db
    .select({ desired_config: managedApplications.desired_config })
    .from(managedApplications)
    .where(eq(managedApplications.id, applicationId))
    .limit(1)) as { desired_config: unknown }[];
  return row?.desired_config &&
    typeof row.desired_config === "object" &&
    !Array.isArray(row.desired_config)
    ? (row.desired_config as Record<string, unknown>)
    : {};
}

function desiredConfigPatchFromTerraformOutputs(
  appKey: string,
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  if (appKey !== "n8n") return {};
  const publicUrl = stringOutputValue(outputs, "n8n_url");
  return compactRecord({
    databaseName: stringOutputValue(outputs, "n8n_database_name"),
    databaseUrlSecretArn: stringOutputValue(outputs, "n8n_database_secret_arn"),
    serviceCredentialSecretArn: stringOutputValue(
      outputs,
      "n8n_service_credential_secret_arn",
    ),
    agentStepBridgeCredentialSecretArn: stringOutputValue(
      outputs,
      "n8n_agent_step_bridge_credential_secret_arn",
    ),
    storageBucketName: stringOutputValue(outputs, "n8n_storage_bucket_name"),
    storagePrefix: stringOutputValue(outputs, "n8n_storage_prefix"),
    packageConfigDigest: stringOutputValue(
      outputs,
      "n8n_package_config_digest",
    ),
    publicUrl,
    domain: hostFromPublicUrl(publicUrl),
  });
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null || entry === "") return false;
      return true;
    }),
  );
}

function stringOutputValue(
  outputs: Record<string, unknown>,
  key: string,
): string | undefined {
  const output = outputs[key];
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return undefined;
  }
  const value = (output as Record<string, unknown>).value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hostFromPublicUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function parseS3Uri(value: string): { bucket: string; key: string } | null {
  if (!value.startsWith("s3://")) return null;
  const withoutScheme = value.slice("s3://".length);
  const separator = withoutScheme.indexOf("/");
  if (separator <= 0 || separator === withoutScheme.length - 1) return null;
  return {
    bucket: withoutScheme.slice(0, separator),
    key: withoutScheme.slice(separator + 1),
  };
}

async function markJobFailed(args: {
  tenantId: string;
  job: DeploymentJob;
  phase: "plan" | "apply";
  db: DbLike;
  codebuildBuildId: string | null;
  message: string;
}): Promise<DeploymentJob> {
  const [updated] = await args.db
    .update(managedApplicationDeploymentJobs)
    .set({
      status: "failed",
      codebuild_build_arn: args.codebuildBuildId,
      error_message: args.message,
      updated_at: new Date(),
    })
    .where(eq(managedApplicationDeploymentJobs.id, args.job.id))
    .returning();

  await appendEvidenceEvent({
    tenantId: args.tenantId,
    jobId: args.job.id,
    db: args.db,
    eventType: `${args.phase}_evidence_failed`,
    message: args.message,
  });

  return updated ?? args.job;
}

async function appendEvidenceEvent(args: {
  tenantId: string;
  jobId: string;
  db: DbLike;
  eventType: string;
  message: string;
  payload?: Record<string, unknown>;
}) {
  await args.db
    .insert(managedApplicationDeploymentEvents)
    .values({
      tenant_id: args.tenantId,
      job_id: args.jobId,
      event_type: args.eventType,
      message: args.message,
      payload: args.payload ?? {},
      idempotency_key: `${args.jobId}:${args.eventType}`,
    })
    .onConflictDoNothing();
}

async function readEvidenceJson(
  bucket: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const body = JSON.parse(await bodyToString(response.Body)) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch (error) {
    if (isMissingS3ObjectError(error)) return null;
    console.warn(
      `[deployments] deployment evidence lookup failed for s3://${bucket}/${key}: ${
        (error as Error)?.name
      }: ${(error as Error)?.message}`,
    );
    return null;
  }
}

async function readFirstEvidenceJson(
  bucket: string,
  keys: string[],
): Promise<Record<string, unknown> | null> {
  for (const key of keys) {
    const evidence = await readEvidenceJson(bucket, key);
    if (evidence) return evidence;
  }
  return null;
}

function evidenceKeys(args: {
  tenantId: string;
  job: DeploymentJob;
  phase: "plan" | "apply";
}): string[] {
  const keys = new Set<string>();
  const recordedPrefix = phaseAwarePrefix(args.job.evidence_prefix, args.phase);
  if (recordedPrefix) {
    keys.add(`${recordedPrefix}/deployment-evidence.json`);
  }
  keys.add(
    `${args.tenantId}/${args.job.app_key}/${args.job.id}/${args.phase}/deployment-evidence.json`,
  );
  keys.add(`sessions/${args.job.id}/${args.phase}/deployment-evidence.json`);
  return [...keys];
}

function phaseAwarePrefix(
  prefix: string | null,
  phase: "plan" | "apply",
): string | null {
  if (!prefix) return null;
  if (prefix.endsWith(`/${phase}`)) return prefix;
  if (prefix.endsWith("/plan") || prefix.endsWith("/apply")) {
    return prefix.replace(/\/(plan|apply)$/, `/${phase}`);
  }
  return `${prefix.replace(/\/$/, "")}/${phase}`;
}

function currentStatusFromTerraformOutputs(
  appKey: string,
  operation: string,
  outputs: Record<string, unknown>,
): string {
  if (
    isManagedAppKey(appKey) &&
    hasManagedAppStatusIndicator(appKey, outputs)
  ) {
    try {
      return getManagedAppAdapter(appKey).extractStatus(outputs).status;
    } catch (error) {
      console.warn(
        `[deployments] failed to extract managed app status for ${appKey}: ${
          (error as Error).message
        }`,
      );
    }
  }
  return currentStatusForOperation(operation);
}

function isManagedAppKey(value: string): value is ManagedAppKey {
  return value === "cognee" || value === "n8n" || value === "twenty";
}

function hasManagedAppStatusIndicator(
  appKey: ManagedAppKey,
  outputs: Record<string, unknown>,
): boolean {
  const keys =
    appKey === "cognee"
      ? ["cognee_enabled"]
      : [`${appKey}_provisioned`, `${appKey}_runtime_enabled`];
  return keys.some((key) => Object.prototype.hasOwnProperty.call(outputs, key));
}

function currentStatusForOperation(operation: string): string {
  if (operation === "DESTROY") return "disabled";
  if (operation === "PARK") return "parked";
  return "enabled";
}

function failedExitCode(value: number | null): boolean {
  return value !== null && value !== 0;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value ? value : null;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nestedString(
  record: Record<string, unknown>,
  path: string[],
): string | null {
  const value = nestedValue(record, path);
  return typeof value === "string" && value ? value : null;
}

function nestedRecord(
  record: Record<string, unknown>,
  path: string[],
): Record<string, unknown> {
  const value = nestedValue(record, path);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nestedValue(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function bodyToString(body: unknown): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (
    typeof body === "object" &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  ) {
    return body.transformToString();
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
    );
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function isMissingS3ObjectError(error: unknown): boolean {
  const name = (error as Error)?.name;
  return name === "NoSuchKey" || name === "NotFound" || name === "NoSuchBucket";
}
