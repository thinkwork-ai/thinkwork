import { getConfig } from "@thinkwork/runtime-config";
import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "./authz.js";
import {
  readCogneeStatus,
  readManagedApplications,
  readTwentyStatus,
} from "./managedApplications.js";
import { resolveCogneeClusterIdentity } from "./cogneeClusterIdentity.js";
import { resolveCallerTenantId } from "./resolve-auth-user.js";
import { enrichManagedApplicationsWithMcpState } from "../../../lib/managed-mcp-applications.js";
import {
  deploymentProfileConfigFromEnv,
  mergeDeploymentProfileConfig,
  resolveDeploymentProfileConfig,
  resolveDeploymentStatusPointerConfig,
} from "../deployments/shared.js";

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
  const configuredDeploymentProfile = mergeDeploymentProfileConfig(
    deploymentProfileConfigFromEnv(),
    await resolveDeploymentProfileConfig(),
  );
  const deploymentProfile = mergeDeploymentProfileConfig(
    await resolveDeploymentStatusPointerConfig(
      configuredDeploymentProfile.evidenceBucket,
    ),
    configuredDeploymentProfile,
  );
  const cognee = readCogneeStatus();
  // Twenty status is DB-served (managed_applications + deployment jobs);
  // the TWENTY env/SSM projection is retired (plan 2026-06-12-001 U10).
  const twenty = await readTwentyStatus(tenantId);
  const managedApplications = await enrichManagedApplicationsWithMcpState(
    tenantId,
    await readManagedApplications(tenantId),
  );
  const cogneeServiceName =
    process.env.COGNEE_SERVICE_NAME ||
    (cognee.enabled ? `thinkwork-${stage}-cognee` : null);
  const cogneeCluster = resolveCogneeClusterIdentity({
    enabled: cognee.enabled,
    stage,
    region,
    accountId,
  });

  return {
    stage,
    source: "AWS",
    region,
    accountId,
    releaseVersion: deploymentProfile.releaseVersion,
    releaseManifestUrl: deploymentProfile.releaseManifestUrl,
    releaseManifestSha256: deploymentProfile.releaseManifestSha256,
    deploymentControllerArn: deploymentProfile.stateMachineArn,
    deploymentRunnerProjectName: deploymentProfile.runnerProjectName,
    deploymentEvidenceBucket: deploymentProfile.evidenceBucket,
    bucketName:
      process.env.BUCKET_NAME || getConfig("WORKSPACE_BUCKET") || null,
    databaseEndpoint: getConfig("DATABASE_HOST") || null,
    ecrUrl: getConfig("ECR_REPOSITORY_URL") || null,
    adminUrl: getConfig("ADMIN_URL") || null,
    docsUrl: getConfig("DOCS_URL") || null,
    apiEndpoint: process.env.API_ENDPOINT || null,
    appsyncUrl: getConfig("APPSYNC_ENDPOINT") || null,
    appsyncRealtimeUrl: getConfig("APPSYNC_REALTIME_URL") || null,
    hindsightEndpoint: getConfig("HINDSIGHT_ENDPOINT") || null,
    agentcoreStatus: getConfig("AGENTCORE_PI_FUNCTION_NAME")
      ? "managed (always on)"
      : "not deployed",
    hindsightEnabled: !!getConfig("HINDSIGHT_ENDPOINT"),
    managedMemoryEnabled: !!getConfig("AGENTCORE_MEMORY_ID"),
    cogneeEnabled: cognee.enabled,
    cogneeEndpoint: cognee.endpoint,
    cogneeLogGroupName:
      process.env.COGNEE_LOG_GROUP_NAME ||
      (cognee.enabled ? `/thinkwork/${stage}/cognee` : null),
    cogneeBackendMode: cognee.backendMode,
    cogneeClusterArn: cogneeCluster.clusterArn,
    cogneeServiceName,
    twentyProvisioned: twenty.provisioned,
    twentyRuntimeEnabled: twenty.runtimeEnabled,
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
