import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "./authz.js";
import {
  readCogneeStatus,
  readManagedApplications,
  readTwentyStatus,
} from "./managedApplications.js";
import { resolveCallerTenantId } from "./resolve-auth-user.js";
import { enrichManagedApplicationsWithMcpState } from "../../../lib/managed-mcp-applications.js";

export { readCogneeStatus };

/**
 * deploymentStatus — reports deployment infrastructure details from Lambda
 * environment variables plus read-only tenant MCP registry state.
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
  const twenty = readTwentyStatus();
  const managedApplications = await enrichManagedApplicationsWithMcpState(
    tenantId,
    readManagedApplications(),
  );
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
    deploymentControllerArn: stringEnv(
      process.env.THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN ||
        process.env.DEPLOYMENT_STATE_MACHINE_ARN ||
        process.env.VITE_DEPLOYMENT_CONTROLLER_ARN,
    ),
    deploymentRunnerProjectName: stringEnv(
      process.env.THINKWORK_DEPLOYMENT_RUNNER_PROJECT_NAME ||
        process.env.VITE_DEPLOYMENT_RUNNER_PROJECT_NAME,
    ),
    deploymentEvidenceBucket: stringEnv(
      process.env.THINKWORK_EVIDENCE_BUCKET ||
        process.env.THINKWORK_DEPLOYMENT_EVIDENCE_BUCKET ||
        process.env.DEPLOYMENT_EVIDENCE_BUCKET ||
        process.env.VITE_DEPLOYMENT_EVIDENCE_BUCKET,
    ),
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
    twentyProvisioned: twenty.provisioned && !twenty.malformed,
    twentyRuntimeEnabled: twenty.runtimeEnabled && !twenty.malformed,
    twentyUrl: twenty.url,
    twentyClusterArn: twenty.clusterArn,
    twentyServerServiceName: twenty.serverServiceName,
    twentyWorkerServiceName: twenty.workerServiceName,
    twentyServerLogGroupName: twenty.serverLogGroupName,
    twentyWorkerLogGroupName: twenty.workerLogGroupName,
    twentyAlbArn: twenty.albArn,
    twentyTargetGroupArn: twenty.targetGroupArn,
    managedApplications,
  };
};

function stringEnv(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
