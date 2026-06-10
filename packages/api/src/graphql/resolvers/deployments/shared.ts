import { randomUUID } from "node:crypto";
import { StartExecutionCommand, SFNClient } from "@aws-sdk/client-sfn";
import { and, asc, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import {
  managedApplicationDeploymentEvents,
  managedApplicationDeploymentJobs,
  managedApplications,
} from "@thinkwork/database-pg/schema";
import {
  dataImpactForManagedApp,
  managedAppRegistry,
  type ManagedAppKey,
  type ManagedAppOperation,
} from "@thinkwork/deployment-runner/apps/registry";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";

export const MANAGED_APP_CATALOG = [
  ...managedAppRegistry.map((adapter) => ({
    key: adapter.appKey,
    displayName: adapter.displayName,
  })),
] as const;

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
}

const sfn = new SFNClient({});

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
  const app = MANAGED_APP_CATALOG.find((candidate) => candidate.key === key);
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
  const catalog = MANAGED_APP_CATALOG.find((app) => app.key === args.key)!;
  if (existing) {
    const [updated] = await db
      .update(managedApplications)
      .set({
        display_name: catalog.displayName,
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
      display_name: catalog.displayName,
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
  return job ?? null;
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
    process.env.DEPLOYMENT_STATE_MACHINE_ARN ||
    process.env.THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN ||
    null
  );
}

export function deploymentEvidenceBucket(): string | null {
  return (
    process.env.DEPLOYMENT_EVIDENCE_BUCKET ||
    process.env.THINKWORK_DEPLOYMENT_EVIDENCE_BUCKET ||
    null
  );
}

export function defaultReleaseVersion(): string {
  return process.env.THINKWORK_RELEASE_VERSION || "unresolved";
}

export function defaultManifestDigest(): string {
  return process.env.THINKWORK_RELEASE_MANIFEST_SHA256 || "unresolved";
}

export function defaultManifestUrl(): string {
  return process.env.THINKWORK_RELEASE_MANIFEST_URL || "";
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
    release: {
      version: args.releaseVersion,
      manifestUrl,
      manifestSha256: args.manifestDigest,
    },
    desiredConfigVersion: args.desiredConfigVersion,
    desiredConfig: args.desiredConfig,
    manifestImages: args.manifestImages,
    planDigest: args.planDigest,
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
