import { getConfig } from "@thinkwork/runtime-config";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { StartExecutionCommand, SFNClient } from "@aws-sdk/client-sfn";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { and, asc, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import {
  managedApplicationDeploymentEvents,
  managedApplicationDeploymentJobs,
  managedApplications,
  releaseUpdateEvents,
  releaseUpdateJobs,
} from "@thinkwork/database-pg/schema";
import {
  dataImpactForManagedApp,
  managedAppRegistry,
  type ManagedAppKey,
  type ManagedAppOperation,
} from "@thinkwork/deployment-runner/apps/registry";
import { reconcileManagedApplicationDeploymentJobFromEvidence } from "../../../lib/deployments/reconcile-job-evidence.js";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";

const MANAGED_APP_METADATA = [
  ...managedAppRegistry
    .map((adapter) => ({
      key: adapter.appKey,
      displayName: adapter.displayName,
      catalogVisible: adapter.catalogVisible,
    })),
] as const;

export const MANAGED_APP_CATALOG = MANAGED_APP_METADATA.filter(
  (adapter) => adapter.catalogVisible,
);

export type DeploymentOperation = ManagedAppOperation;

export interface DeploymentStartResult {
  executionArn: string | null;
  stateMachineArn: string | null;
}

export const DEPLOYMENT_CONTROLLER_CONTRACT =
  "thinkwork.deployment.controller.v1";

export const DEPLOYMENT_CONTROLLER_SCHEMA_VERSION = 1;

export interface DeploymentDeps {
  startExecution?: (input: {
    stateMachineArn: string;
    name: string;
    payload: Record<string, unknown>;
  }) => Promise<DeploymentStartResult>;
  resolveDeploymentControllerConfig?: () => Promise<DeploymentControllerConfig>;
}

const sfn = new SFNClient({});
const s3 = new S3Client({});
const ssm = new SSMClient({});
let cachedDeploymentControllerConfig: DeploymentControllerConfig | null = null;
let cachedDeploymentProfile: DeploymentProfileConfig | null = null;
let cachedDeploymentStatusPointer: DeploymentProfileConfig | null = null;

export interface DeploymentControllerConfig {
  stateMachineArn: string | null;
  evidenceBucket: string | null;
  customerDomain?: string | null;
  customerDomainDelegated?: boolean | null;
  customerDomainLegacyRetired?: boolean | null;
  appCertificateArn?: string | null;
}

export interface DeploymentProfileConfig extends DeploymentControllerConfig {
  releaseVersion: string | null;
  releaseManifestUrl: string | null;
  releaseManifestSha256: string | null;
  releaseManifestSignatureUrl: string | null;
  releaseManifestTrustPolicy: string | null;
  releaseManifestTrustedKeysJson: string | null;
  runnerProjectName: string | null;
}

export async function requireDeploymentTenantAdmin(
  ctx: GraphQLContext,
): Promise<{ tenantId: string; callerUserId: string | null }> {
  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  await requireTenantAdmin(ctx, tenantId);
  return { tenantId, callerUserId: await resolveCallerUserId(ctx) };
}

export function normalizeManagedAppKey(value: unknown): ManagedAppKey {
  const key = typeof value === "string" ? value.toLowerCase() : "";
  if (key === "knowledge-graph" || key === "knowledge_graph") return "cognee";
  const app = MANAGED_APP_METADATA.find((candidate) => candidate.key === key);
  if (!app) {
    throw new GraphQLError("Unknown managed application key", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return app.key;
}

export function normalizeDeploymentOperation(
  value: unknown,
): DeploymentOperation {
  const operation = typeof value === "string" ? value.toUpperCase() : "";
  if (
    operation === "ENABLE" ||
    operation === "PARK" ||
    operation === "DESTROY" ||
    operation === "UPGRADE"
  ) {
    return operation;
  }
  throw new GraphQLError(
    "Managed application deployment operation is required",
    {
      extensions: { code: "BAD_USER_INPUT" },
    },
  );
}

export async function ensureManagedApplication(args: {
  tenantId: string;
  key: ManagedAppKey;
  desiredStatus: string;
  desiredConfig: Record<string, unknown>;
  releaseVersion: string;
  manifestDigest: string;
}) {
  const [existing] = await db
    .select()
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, args.tenantId),
        eq(managedApplications.key, args.key),
      ),
    )
    .limit(1);
  const metadata = MANAGED_APP_METADATA.find((app) => app.key === args.key);
  if (!metadata) {
    throw new GraphQLError("Unknown managed application key", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (existing) {
    const [updated] = await db
      .update(managedApplications)
      .set({
        display_name: metadata.displayName,
        desired_status: args.desiredStatus,
        desired_config: args.desiredConfig,
        selected_release_version: args.releaseVersion,
        selected_manifest_digest: args.manifestDigest,
        updated_at: new Date(),
      })
      .where(eq(managedApplications.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [created] = await db
    .insert(managedApplications)
    .values({
      tenant_id: args.tenantId,
      key: args.key,
      display_name: metadata.displayName,
      desired_status: args.desiredStatus,
      desired_config: args.desiredConfig,
      selected_release_version: args.releaseVersion,
      selected_manifest_digest: args.manifestDigest,
    })
    .returning();
  return created;
}

export async function loadDeploymentJobForTenant(
  tenantId: string,
  jobId: string,
) {
  const [job] = await db
    .select()
    .from(managedApplicationDeploymentJobs)
    .where(
      and(
        eq(managedApplicationDeploymentJobs.tenant_id, tenantId),
        eq(managedApplicationDeploymentJobs.id, jobId),
      ),
    )
    .limit(1);
  if (!job) return null;
  return reconcileManagedApplicationDeploymentJobFromEvidence(tenantId, job);
}

export async function loadJobEvents(tenantId: string, jobId: string) {
  return db
    .select()
    .from(managedApplicationDeploymentEvents)
    .where(
      and(
        eq(managedApplicationDeploymentEvents.tenant_id, tenantId),
        eq(managedApplicationDeploymentEvents.job_id, jobId),
      ),
    )
    .orderBy(asc(managedApplicationDeploymentEvents.created_at));
}

export async function loadReleaseUpdateJobForTenant(
  tenantId: string,
  jobId: string,
) {
  const [job] = await db
    .select()
    .from(releaseUpdateJobs)
    .where(
      and(
        eq(releaseUpdateJobs.tenant_id, tenantId),
        eq(releaseUpdateJobs.id, jobId),
      ),
    )
    .limit(1);
  return job ?? null;
}

export async function loadReleaseUpdateEvents(tenantId: string, jobId: string) {
  return db
    .select()
    .from(releaseUpdateEvents)
    .where(
      and(
        eq(releaseUpdateEvents.tenant_id, tenantId),
        eq(releaseUpdateEvents.job_id, jobId),
      ),
    )
    .orderBy(asc(releaseUpdateEvents.created_at));
}

export async function appendJobEvent(args: {
  tenantId: string;
  jobId: string;
  eventType: string;
  message: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  const insert = db.insert(managedApplicationDeploymentEvents).values({
    tenant_id: args.tenantId,
    job_id: args.jobId,
    event_type: args.eventType,
    message: args.message,
    payload: args.payload ?? {},
    idempotency_key: args.idempotencyKey,
  });
  if (args.idempotencyKey) {
    await insert.onConflictDoNothing();
    return;
  }
  await insert;
}

export async function appendReleaseUpdateEvent(args: {
  tenantId: string;
  jobId: string;
  eventType: string;
  message: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  const insert = db.insert(releaseUpdateEvents).values({
    tenant_id: args.tenantId,
    job_id: args.jobId,
    event_type: args.eventType,
    message: args.message,
    payload: args.payload ?? {},
    idempotency_key: args.idempotencyKey,
  });
  if (args.idempotencyKey) {
    await insert.onConflictDoNothing();
    return;
  }
  await insert;
}

export async function defaultStartExecution(input: {
  stateMachineArn: string;
  name: string;
  payload: Record<string, unknown>;
}): Promise<DeploymentStartResult> {
  const response = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn: input.stateMachineArn,
      name: input.name,
      input: JSON.stringify(input.payload),
    }),
  );
  return {
    executionArn: response.executionArn ?? null,
    stateMachineArn: input.stateMachineArn,
  };
}

export function deploymentStateMachineArn(): string | null {
  return (
    getConfig("DEPLOYMENT_STATE_MACHINE_ARN") ||
    process.env.THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN ||
    null
  );
}

export function deploymentEvidenceBucket(): string | null {
  return (
    getConfig("DEPLOYMENT_EVIDENCE_BUCKET") ||
    process.env.THINKWORK_DEPLOYMENT_EVIDENCE_BUCKET ||
    null
  );
}

export async function resolveDeploymentControllerConfig(): Promise<DeploymentControllerConfig> {
  if (cachedDeploymentControllerConfig?.stateMachineArn) {
    return cachedDeploymentControllerConfig;
  }

  const evidenceBucket = deploymentEvidenceBucket();
  const profile = mergeDeploymentProfileConfig(
    await resolveDeploymentProfileConfig(),
    deploymentProfileConfigFromEnv(),
  );
  if (profile.stateMachineArn) {
    cachedDeploymentControllerConfig = controllerConfigFromProfile(profile);
    return cachedDeploymentControllerConfig;
  }

  const pointer = await resolveDeploymentStatusPointerConfig(
    profile.evidenceBucket ?? evidenceBucket,
  );
  if (pointer.stateMachineArn) {
    cachedDeploymentControllerConfig = {
      stateMachineArn: pointer.stateMachineArn,
      evidenceBucket: pointer.evidenceBucket ?? profile.evidenceBucket,
      customerDomain: pointer.customerDomain ?? profile.customerDomain,
      customerDomainDelegated:
        pointer.customerDomainDelegated ?? profile.customerDomainDelegated,
      customerDomainLegacyRetired:
        pointer.customerDomainLegacyRetired ??
        profile.customerDomainLegacyRetired,
      appCertificateArn: pointer.appCertificateArn ?? profile.appCertificateArn,
    };
    return cachedDeploymentControllerConfig;
  }

  return {
    stateMachineArn: null,
    evidenceBucket: profile.evidenceBucket,
    customerDomain: profile.customerDomain,
    customerDomainDelegated: profile.customerDomainDelegated,
    customerDomainLegacyRetired: profile.customerDomainLegacyRetired,
    appCertificateArn: profile.appCertificateArn,
  };
}

export async function resolveDeploymentProfileConfig(): Promise<DeploymentProfileConfig> {
  const emptyProfile: DeploymentProfileConfig = {
    releaseVersion: null,
    releaseManifestUrl: null,
    releaseManifestSha256: null,
    releaseManifestSignatureUrl: null,
    releaseManifestTrustPolicy: null,
    releaseManifestTrustedKeysJson: null,
    stateMachineArn: null,
    evidenceBucket: deploymentEvidenceBucket(),
    runnerProjectName: null,
    customerDomain: null,
    customerDomainDelegated: null,
    customerDomainLegacyRetired: null,
    appCertificateArn: null,
  };
  if (cachedDeploymentProfile) {
    return cachedDeploymentProfile;
  }

  const stage = process.env.STAGE || process.env.THINKWORK_STAGE || "";
  if (!stage) {
    cachedDeploymentProfile = emptyProfile;
    return cachedDeploymentProfile;
  }

  try {
    const response = await ssm.send(
      new GetParameterCommand({
        Name: `/thinkwork/${stage}/deployment/profile/json`,
        WithDecryption: true,
      }),
    );
    const profile = JSON.parse(response.Parameter?.Value || "{}") as Record<
      string,
      unknown
    >;
    const controller =
      profile.controller && typeof profile.controller === "object"
        ? (profile.controller as Record<string, unknown>)
        : {};
    cachedDeploymentProfile = {
      releaseVersion: stringField(profile, "releaseVersion"),
      releaseManifestUrl: stringField(profile, "releaseManifestUrl"),
      releaseManifestSha256: stringField(profile, "releaseManifestSha256"),
      releaseManifestSignatureUrl: stringField(
        profile,
        "releaseManifestSignatureUrl",
      ),
      releaseManifestTrustPolicy: stringField(
        profile,
        "releaseManifestTrustPolicy",
      ),
      releaseManifestTrustedKeysJson: stringField(
        profile,
        "releaseManifestTrustedKeysJson",
      ),
      stateMachineArn: stringField(controller, "stateMachineArn"),
      evidenceBucket: stringField(controller, "evidenceBucketName"),
      runnerProjectName: stringField(controller, "codebuildProjectName"),
      customerDomain:
        stringField(profile, "customerDomain") ??
        stringField(controller, "customerDomain"),
      customerDomainDelegated:
        booleanField(profile, "customerDomainDelegated") ??
        booleanField(controller, "customerDomainDelegated"),
      customerDomainLegacyRetired:
        booleanField(profile, "customerDomainLegacyRetired") ??
        booleanField(controller, "customerDomainLegacyRetired"),
      appCertificateArn:
        stringField(profile, "appCertificateArn") ??
        stringField(controller, "appCertificateArn"),
    };
    return cachedDeploymentProfile;
  } catch (error) {
    console.warn(
      `[deployments] deployment profile SSM lookup failed: ${
        (error as Error)?.name
      }: ${(error as Error)?.message}`,
    );
    return emptyProfile;
  }
}

export async function resolveDeploymentStatusPointerConfig(
  evidenceBucket: string | null,
): Promise<DeploymentProfileConfig> {
  const emptyProfile: DeploymentProfileConfig = {
    releaseVersion: null,
    releaseManifestUrl: null,
    releaseManifestSha256: null,
    releaseManifestSignatureUrl: null,
    releaseManifestTrustPolicy: null,
    releaseManifestTrustedKeysJson: null,
    stateMachineArn: null,
    evidenceBucket,
    runnerProjectName: null,
    customerDomain: null,
    customerDomainDelegated: null,
    customerDomainLegacyRetired: null,
    appCertificateArn: null,
  };
  if (!evidenceBucket) {
    cachedDeploymentStatusPointer = emptyProfile;
    return cachedDeploymentStatusPointer;
  }
  if (cachedDeploymentStatusPointer?.evidenceBucket === evidenceBucket) {
    return cachedDeploymentStatusPointer;
  }

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: evidenceBucket,
        Key: "deployment/status/current.json",
      }),
    );
    const status = JSON.parse(await bodyToString(response.Body)) as Record<
      string,
      unknown
    >;
    const activeRelease =
      status.activeRelease && typeof status.activeRelease === "object"
        ? (status.activeRelease as Record<string, unknown>)
        : {};
    const controller =
      status.controller && typeof status.controller === "object"
        ? (status.controller as Record<string, unknown>)
        : {};
    cachedDeploymentStatusPointer = {
      releaseVersion: stringField(activeRelease, "version"),
      releaseManifestUrl: stringField(activeRelease, "manifestUrl"),
      releaseManifestSha256: stringField(activeRelease, "manifestSha256"),
      releaseManifestSignatureUrl: stringField(
        activeRelease,
        "manifestSignatureUrl",
      ),
      releaseManifestTrustPolicy: stringField(
        activeRelease,
        "manifestTrustPolicy",
      ),
      releaseManifestTrustedKeysJson: null,
      stateMachineArn: stringField(controller, "stateMachineArn"),
      evidenceBucket,
      runnerProjectName: stringField(controller, "codebuildProjectName"),
      customerDomain: stringField(controller, "customerDomain"),
      customerDomainDelegated: booleanField(
        controller,
        "customerDomainDelegated",
      ),
      customerDomainLegacyRetired: booleanField(
        controller,
        "customerDomainLegacyRetired",
      ),
      appCertificateArn: stringField(controller, "appCertificateArn"),
    };
    return cachedDeploymentStatusPointer;
  } catch (error) {
    if (isMissingS3ObjectError(error)) {
      cachedDeploymentStatusPointer = emptyProfile;
      return cachedDeploymentStatusPointer;
    }
    console.warn(
      `[deployments] deployment status pointer lookup failed: ${
        (error as Error)?.name
      }: ${(error as Error)?.message}`,
    );
    cachedDeploymentStatusPointer = emptyProfile;
    return cachedDeploymentStatusPointer;
  }
}

export function resetDeploymentProfileCacheForTests() {
  cachedDeploymentControllerConfig = null;
  cachedDeploymentProfile = null;
  cachedDeploymentStatusPointer = null;
}

export function deploymentProfileConfigFromEnv(): DeploymentProfileConfig {
  return {
    releaseVersion: stringEnv(
      process.env.THINKWORK_RELEASE_VERSION || process.env.VITE_RELEASE_VERSION,
    ),
    releaseManifestUrl: stringEnv(
      process.env.THINKWORK_RELEASE_MANIFEST_URL ||
        process.env.VITE_RELEASE_MANIFEST_URL,
    ),
    releaseManifestSha256: stringEnv(
      process.env.THINKWORK_RELEASE_MANIFEST_SHA256 ||
        process.env.VITE_RELEASE_MANIFEST_SHA256,
    ),
    releaseManifestSignatureUrl: stringEnv(
      process.env.THINKWORK_RELEASE_MANIFEST_SIGNATURE_URL,
    ),
    releaseManifestTrustPolicy: stringEnv(
      process.env.THINKWORK_RELEASE_MANIFEST_TRUST_POLICY,
    ),
    releaseManifestTrustedKeysJson: stringEnv(
      process.env.THINKWORK_RELEASE_MANIFEST_TRUSTED_KEYS_JSON,
    ),
    stateMachineArn: stringEnv(
      process.env.THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN ||
        getConfig("DEPLOYMENT_STATE_MACHINE_ARN") ||
        process.env.VITE_DEPLOYMENT_CONTROLLER_ARN,
    ),
    evidenceBucket: stringEnv(
      process.env.THINKWORK_EVIDENCE_BUCKET ||
        process.env.THINKWORK_DEPLOYMENT_EVIDENCE_BUCKET ||
        getConfig("DEPLOYMENT_EVIDENCE_BUCKET") ||
        process.env.VITE_DEPLOYMENT_EVIDENCE_BUCKET,
    ),
    runnerProjectName: stringEnv(
      process.env.THINKWORK_DEPLOYMENT_RUNNER_PROJECT_NAME ||
        process.env.VITE_DEPLOYMENT_RUNNER_PROJECT_NAME,
    ),
    customerDomain: stringEnv(
      process.env.THINKWORK_CUSTOMER_DOMAIN ||
        process.env.VITE_CUSTOMER_DOMAIN,
    ),
    customerDomainDelegated: booleanEnv(
      process.env.THINKWORK_CUSTOMER_DOMAIN_DELEGATED ||
        process.env.VITE_CUSTOMER_DOMAIN_DELEGATED,
    ),
    customerDomainLegacyRetired: booleanEnv(
      process.env.THINKWORK_CUSTOMER_DOMAIN_LEGACY_RETIRED ||
        process.env.VITE_CUSTOMER_DOMAIN_LEGACY_RETIRED,
    ),
    appCertificateArn: stringEnv(
      process.env.THINKWORK_APP_CERTIFICATE_ARN ||
        process.env.VITE_APP_CERTIFICATE_ARN,
    ),
  };
}

function stringEnv(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanEnv(value: string | undefined): boolean | null {
  if (value === undefined || !value.trim()) return null;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function mergeDeploymentProfileConfig(
  primary: DeploymentProfileConfig,
  fallback: DeploymentProfileConfig,
): DeploymentProfileConfig {
  return {
    releaseVersion: primary.releaseVersion ?? fallback.releaseVersion,
    releaseManifestUrl:
      primary.releaseManifestUrl ?? fallback.releaseManifestUrl,
    releaseManifestSha256:
      primary.releaseManifestSha256 ?? fallback.releaseManifestSha256,
    releaseManifestSignatureUrl:
      primary.releaseManifestSignatureUrl ??
      fallback.releaseManifestSignatureUrl,
    releaseManifestTrustPolicy:
      primary.releaseManifestTrustPolicy ?? fallback.releaseManifestTrustPolicy,
    releaseManifestTrustedKeysJson:
      primary.releaseManifestTrustedKeysJson ??
      fallback.releaseManifestTrustedKeysJson,
    stateMachineArn: primary.stateMachineArn ?? fallback.stateMachineArn,
    evidenceBucket: primary.evidenceBucket ?? fallback.evidenceBucket,
    runnerProjectName: primary.runnerProjectName ?? fallback.runnerProjectName,
    customerDomain: primary.customerDomain ?? fallback.customerDomain,
    customerDomainDelegated:
      primary.customerDomainDelegated ?? fallback.customerDomainDelegated,
    customerDomainLegacyRetired:
      primary.customerDomainLegacyRetired ??
      fallback.customerDomainLegacyRetired,
    appCertificateArn: primary.appCertificateArn ?? fallback.appCertificateArn,
  };
}

function controllerConfigFromProfile(
  profile: DeploymentProfileConfig,
): DeploymentControllerConfig {
  return {
    stateMachineArn: profile.stateMachineArn,
    evidenceBucket: profile.evidenceBucket,
    customerDomain: profile.customerDomain,
    customerDomainDelegated: profile.customerDomainDelegated,
    customerDomainLegacyRetired: profile.customerDomainLegacyRetired,
    appCertificateArn: profile.appCertificateArn,
  };
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value ? value : null;
}

function booleanField(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
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
  return name === "NoSuchKey" || name === "NotFound";
}

export function defaultReleaseVersion(): string {
  return process.env.THINKWORK_RELEASE_VERSION?.trim() || "unresolved";
}

export function defaultManifestDigest(): string {
  return process.env.THINKWORK_RELEASE_MANIFEST_SHA256?.trim() || "unresolved";
}

export function defaultManifestUrl(): string {
  return process.env.THINKWORK_RELEASE_MANIFEST_URL?.trim() || "";
}

export interface ResolvedReleaseMetadata {
  releaseVersion: string;
  manifestDigest: string;
  releaseManifestUrl: string;
}

export function assertResolvedRelease(args: {
  appKey: ManagedAppKey;
  operation: DeploymentOperation;
  releaseVersion: string | null | undefined;
  manifestDigest: string | null | undefined;
  releaseManifestUrl?: string | null | undefined;
}): ResolvedReleaseMetadata {
  const releaseVersion = args.releaseVersion?.trim() || "unresolved";
  const manifestDigest = args.manifestDigest?.trim() || "unresolved";
  const releaseManifestUrl = args.releaseManifestUrl?.trim() || "";
  if (releaseVersion === "unresolved" || manifestDigest === "unresolved") {
    throw new GraphQLError(
      `Cannot start a ${args.operation} deployment job for ${args.appKey}: release is ` +
        `unresolved (releaseVersion="${releaseVersion}", ` +
        `manifestDigest="${manifestDigest}"). Resolve a real release before ` +
        `creating the job.`,
      { extensions: { code: "FAILED_PRECONDITION" } },
    );
  }
  if (!/^[a-f0-9]{64}$/i.test(manifestDigest)) {
    throw new GraphQLError(
      `Cannot start a ${args.operation} deployment job for ${args.appKey}: ` +
        "manifestDigest must be a 64-character SHA-256 hex digest.",
      { extensions: { code: "FAILED_PRECONDITION" } },
    );
  }
  return { releaseVersion, manifestDigest, releaseManifestUrl };
}

export async function resolveDefaultReleaseMetadata(): Promise<{
  releaseVersion: string | null;
  manifestDigest: string | null;
  releaseManifestUrl: string | null;
}> {
  const env = deploymentProfileConfigFromEnv();
  const profile = await resolveDeploymentProfileConfig();
  const pointer = await resolveDeploymentStatusPointerConfig(
    profile.evidenceBucket ?? env.evidenceBucket,
  );
  return {
    releaseVersion: firstResolvedReleaseValue(
      pointer.releaseVersion,
      profile.releaseVersion,
      env.releaseVersion,
      defaultReleaseVersion(),
    ),
    manifestDigest: firstResolvedReleaseValue(
      pointer.releaseManifestSha256,
      profile.releaseManifestSha256,
      env.releaseManifestSha256,
      defaultManifestDigest(),
    ),
    releaseManifestUrl:
      pointer.releaseManifestUrl ??
      profile.releaseManifestUrl ??
      env.releaseManifestUrl ??
      defaultManifestUrl(),
  };
}

function firstResolvedReleaseValue(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && trimmed !== "unresolved") return trimmed;
  }
  return null;
}

export function buildManagedAppControllerPayload(args: {
  phase: "plan" | "apply";
  tenantId: string;
  jobId: string;
  appKey: ManagedAppKey;
  operation: DeploymentOperation;
  releaseVersion: string;
  manifestDigest: string;
  releaseManifestUrl?: string | null;
  desiredConfigVersion: string;
  desiredConfig?: Record<string, unknown>;
  manifestImages?: Record<string, string>;
  planDigest?: string | null;
  evidenceBucket?: string | null;
  customerDomain?: string | null;
  customerDomainDelegated?: boolean | null;
  customerDomainLegacyRetired?: boolean | null;
  appCertificateArn?: string | null;
}): Record<string, unknown> {
  const evidencePrefix = managedAppEvidencePrefix({
    tenantId: args.tenantId,
    appKey: args.appKey,
    jobId: args.jobId,
    phase: args.phase,
  });
  const manifestUrl = args.releaseManifestUrl || defaultManifestUrl();
  return {
    schemaVersion: DEPLOYMENT_CONTROLLER_SCHEMA_VERSION,
    contract: DEPLOYMENT_CONTROLLER_CONTRACT,
    phase: args.phase,
    action: args.phase === "plan" ? "plan" : "update",
    tenantId: args.tenantId,
    jobId: args.jobId,
    sessionId: args.jobId,
    appKey: args.appKey,
    operation: args.operation,
    releaseVersion: args.releaseVersion,
    manifestDigest: args.manifestDigest,
    releaseManifestUrl: manifestUrl,
    releaseManifestSha256: args.manifestDigest,
    terraformModuleVersion: args.releaseVersion,
    release: {
      version: args.releaseVersion,
      manifestUrl,
      manifestSha256: args.manifestDigest,
    },
    desiredConfigVersion: args.desiredConfigVersion,
    desiredConfig: args.desiredConfig,
    manifestImages: args.manifestImages,
    planDigest: args.planDigest,
    ...(args.customerDomain ? { customerDomain: args.customerDomain } : {}),
    ...(args.customerDomainDelegated !== null &&
    args.customerDomainDelegated !== undefined
      ? { customerDomainDelegated: args.customerDomainDelegated }
      : {}),
    ...(args.customerDomainLegacyRetired !== null &&
    args.customerDomainLegacyRetired !== undefined
      ? { customerDomainLegacyRetired: args.customerDomainLegacyRetired }
      : {}),
    ...(args.appCertificateArn
      ? { appCertificateArn: args.appCertificateArn }
      : {}),
    evidenceBucket: args.evidenceBucket,
    evidence: {
      bucket: args.evidenceBucket,
      prefix: evidencePrefix,
      expectedArtifacts:
        args.phase === "plan"
          ? ["plan-summary.json", "terraform-variables.json"]
          : ["apply-summary.json", "smoke-results.json"],
    },
    features: {
      baseInstall: {
        cognee: false,
        slack: false,
        stripe: false,
        twenty: false,
      },
      optionalApps: [args.appKey],
    },
    operationContract: {
      kind: "managed_app",
      appKey: args.appKey,
      operation: args.operation,
      destructive: args.operation === "DESTROY",
    },
  };
}

export function managedAppEvidencePrefix(args: {
  tenantId: string;
  appKey: string;
  jobId: string;
  phase: "plan" | "apply";
}): string {
  return `${args.tenantId}/${args.appKey}/${args.jobId}/${args.phase}`;
}

export function parseAwsJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || value === "") return {};
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GraphQLError("Expected a JSON object", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return parsed as Record<string, unknown>;
}

export function toDeploymentPayload(
  job: Record<string, unknown>,
  events: unknown[] = [],
): any {
  return {
    ...snakeToCamel(job),
    events: events.map((event) =>
      snakeToCamel(event as Record<string, unknown>),
    ),
  };
}

export function toReleaseUpdatePayload(
  job: Record<string, unknown>,
  events: unknown[] = [],
): any {
  return {
    ...snakeToCamel(job),
    events: events.map((event) =>
      snakeToCamel(event as Record<string, unknown>),
    ),
  };
}

export function desiredStatusFor(operation: DeploymentOperation): string {
  if (operation === "ENABLE" || operation === "UPGRADE") return "enabled";
  if (operation === "PARK") return "parked";
  return "disabled";
}

export function dataImpactFor(
  appKey: ManagedAppKey,
  operation: DeploymentOperation,
) {
  return dataImpactForManagedApp(appKey, operation);
}

export function executionName(jobId: string, phase: "plan" | "apply") {
  return `tw-${phase}-${jobId.replace(/-/g, "").slice(0, 48) || randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
