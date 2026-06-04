import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "./authz.js";
import { resolveCallerTenantId } from "./resolve-auth-user.js";

type CogneeStatus = {
  enabled: boolean;
  endpoint: string | null;
  backendMode: string | null;
};

export function readCogneeStatus(): CogneeStatus {
  const legacyEndpoint = process.env.COGNEE_ENDPOINT || null;
  const legacyBackendMode = process.env.COGNEE_BACKEND_MODE || null;
  const raw = process.env.COGNEE || process.env.COGNEE_STATUS;

  if (!raw) {
    return {
      enabled: Boolean(
        legacyEndpoint ||
        process.env.COGNEE_SERVICE_NAME ||
        process.env.COGNEE_LOG_GROUP_NAME,
      ),
      endpoint: legacyEndpoint,
      backendMode: legacyBackendMode,
    };
  }

  const separatorIndex = raw.indexOf("|");
  if (separatorIndex >= 0) {
    const backend = raw.slice(0, separatorIndex).trim();
    const endpoint = raw.slice(separatorIndex + 1).trim();
    return {
      enabled: true,
      endpoint: endpoint || legacyEndpoint,
      backendMode: backend || legacyBackendMode,
    };
  }

  try {
    const parsed = JSON.parse(raw) as {
      endpoint?: unknown;
      backend?: unknown;
    };
    const endpoint =
      typeof parsed.endpoint === "string" && parsed.endpoint.trim()
        ? parsed.endpoint
        : legacyEndpoint;
    const backendMode =
      typeof parsed.backend === "string" && parsed.backend.trim()
        ? parsed.backend
        : legacyBackendMode;
    return {
      enabled: true,
      endpoint,
      backendMode,
    };
  } catch {
    return {
      enabled: raw === "true" || Boolean(legacyEndpoint),
      endpoint: legacyEndpoint,
      backendMode: legacyBackendMode,
    };
  }
}

/**
 * deploymentStatus — reports deployment infrastructure details from Lambda
 * environment variables. No DB access, no live AWS API calls.
 *
 * Operator-only: the payload includes account ID, DB endpoint, ECR URL, and
 * AppSync/Hindsight endpoints. Frontend hiding is not a security boundary, so
 * the gate lives here — a member who hand-issues this query must be refused.
 * Service callers (trusted backends) pass through.
 */

export const deploymentStatus = async (
  _parent: any,
  _args: any,
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveCallerTenantId(ctx);
  await requireAdminOrServiceCaller(
    ctx,
    tenantId ?? "",
    "deployment_status:read",
  );
  const stage = process.env.STAGE || "unknown";
  const region = process.env.AWS_REGION || "us-east-1";
  const accountId = process.env.AWS_ACCOUNT_ID || null;
  const cognee = readCogneeStatus();
  const cogneeServiceName =
    process.env.COGNEE_SERVICE_NAME ||
    (cognee.enabled ? `thinkwork-${stage}-cognee` : null);
  const cogneeClusterArn =
    process.env.COGNEE_CLUSTER_ARN ||
    (cognee.enabled && accountId
      ? `arn:aws:ecs:${region}:${accountId}:cluster/thinkwork-${stage}-cognee-cluster`
      : null);

  return {
    stage,
    source: "AWS",
    region,
    accountId,
    bucketName: process.env.BUCKET_NAME || null,
    databaseEndpoint: process.env.DATABASE_HOST || null,
    ecrUrl: process.env.ECR_REPOSITORY_URL || null,
    adminUrl: process.env.ADMIN_URL || null,
    docsUrl: process.env.DOCS_URL || null,
    apiEndpoint: process.env.API_ENDPOINT || null,
    appsyncUrl: process.env.APPSYNC_ENDPOINT || null,
    appsyncRealtimeUrl: process.env.APPSYNC_REALTIME_URL || null,
    hindsightEndpoint: process.env.HINDSIGHT_ENDPOINT || null,
    agentcoreStatus: process.env.AGENTCORE_PI_FUNCTION_NAME
      ? "managed (always on)"
      : "not deployed",
    hindsightEnabled: !!process.env.HINDSIGHT_ENDPOINT,
    managedMemoryEnabled: !!process.env.AGENTCORE_MEMORY_ID,
    cogneeEnabled: cognee.enabled,
    cogneeEndpoint: cognee.endpoint,
    cogneeLogGroupName:
      process.env.COGNEE_LOG_GROUP_NAME ||
      (cognee.enabled ? `/thinkwork/${stage}/cognee` : null),
    cogneeBackendMode: cognee.backendMode,
    cogneeClusterArn,
    cogneeServiceName,
  };
};
