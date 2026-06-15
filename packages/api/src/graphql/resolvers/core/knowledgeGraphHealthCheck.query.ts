import {
  DescribeServicesCommand,
  ECSClient,
  type Service,
} from "@aws-sdk/client-ecs";
import {
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
  type TargetHealthDescription,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "./authz.js";
import { resolveCogneeClusterIdentity } from "./cogneeClusterIdentity.js";
import { readCogneeStatus } from "./managedApplications.js";
import { resolveCallerTenantId } from "./resolve-auth-user.js";

const AWS_HEALTH_TIMEOUT_MS = 3500;

type CogneeAwsHealth = {
  healthy: boolean;
  message: string;
};

function requestHandler() {
  return new NodeHttpHandler({
    connectionTimeout: 1500,
    requestTimeout: AWS_HEALTH_TIMEOUT_MS,
  });
}

function stageName(): string {
  return process.env.STAGE || "dev";
}

function regionName(): string {
  return process.env.AWS_REGION || "us-east-1";
}

function cogneeServiceName(stage: string): string {
  return process.env.COGNEE_SERVICE_NAME || `thinkwork-${stage}-cognee`;
}

function cogneeClusterRef(stage: string): string {
  return (
    resolveCogneeClusterIdentity({
      enabled: true,
      stage,
      region: regionName(),
      accountId: process.env.AWS_ACCOUNT_ID || null,
    }).clusterRef || `thinkwork-${stage}-brain-cluster`
  );
}

function cogneeTargetGroupName(stage: string): string {
  return `tw-${stage}-cognee`;
}

function serviceIsSteady(service: Service | undefined): boolean {
  if (!service || service.status !== "ACTIVE") return false;

  const desiredCount = service.desiredCount ?? 0;
  const runningCount = service.runningCount ?? 0;
  const pendingCount = service.pendingCount ?? 0;
  const primaryDeployment = service.deployments?.find(
    (deployment) => deployment.status === "PRIMARY",
  );
  const primaryCompleted =
    !primaryDeployment || primaryDeployment.rolloutState === "COMPLETED";

  return (
    desiredCount > 0 &&
    runningCount >= desiredCount &&
    pendingCount === 0 &&
    primaryCompleted
  );
}

function healthyTargetCount(targets: TargetHealthDescription[]): number {
  return targets.filter((target) => target.TargetHealth?.State === "healthy")
    .length;
}

export async function probeCogneeAwsHealth(): Promise<CogneeAwsHealth> {
  const stage = stageName();
  const region = regionName();
  const serviceName = cogneeServiceName(stage);
  const cluster = cogneeClusterRef(stage);
  const targetGroupName = cogneeTargetGroupName(stage);
  const ecs = new ECSClient({ region, requestHandler: requestHandler() });
  const elbv2 = new ElasticLoadBalancingV2Client({
    region,
    requestHandler: requestHandler(),
  });

  const services = await ecs.send(
    new DescribeServicesCommand({
      cluster,
      services: [serviceName],
    }),
  );
  const service = services.services?.[0];
  if (!serviceIsSteady(service)) {
    return {
      healthy: false,
      message: `Cognee ECS service ${serviceName} is not steady.`,
    };
  }

  const targetGroups = await elbv2.send(
    new DescribeTargetGroupsCommand({ Names: [targetGroupName] }),
  );
  const targetGroupArn = targetGroups.TargetGroups?.[0]?.TargetGroupArn;
  if (!targetGroupArn) {
    return {
      healthy: false,
      message: `Cognee target group ${targetGroupName} was not found.`,
    };
  }

  const targetHealth = await elbv2.send(
    new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn }),
  );
  const targets = targetHealth.TargetHealthDescriptions ?? [];
  const desiredCount = service?.desiredCount ?? 1;
  const healthyCount = healthyTargetCount(targets);

  if (healthyCount < desiredCount) {
    return {
      healthy: false,
      message: `Cognee ALB target group ${targetGroupName} has ${healthyCount}/${desiredCount} healthy targets.`,
    };
  }

  return {
    healthy: true,
    message: "Cognee ECS service is steady and the ALB target is healthy.",
  };
}

/**
 * knowledgeGraphHealthCheck — operator-only live probe for the private Cognee
 * service. The GraphQL Lambda is intentionally outside Cognee's VPC path, so
 * this checks ECS service steadiness and ALB target health through AWS control
 * plane APIs instead of fetching the internal ALB directly.
 */
export const knowledgeGraphHealthCheck = async (
  _parent: any,
  _args: any,
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveCallerTenantId(ctx);
  await requireAdminOrServiceCaller(
    ctx,
    tenantId ?? "",
    "knowledge_graph:health_check",
  );

  const cognee = readCogneeStatus();
  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();

  if (!cognee.enabled || !cognee.endpoint) {
    return {
      healthy: false,
      statusCode: null,
      latencyMs: 0,
      endpoint: cognee.endpoint,
      checkedAt,
      message: "Cognee is not provisioned for this stage.",
    };
  }

  try {
    const health = await probeCogneeAwsHealth();
    const latencyMs = Date.now() - startedAt;
    return {
      healthy: health.healthy,
      statusCode: health.healthy ? 200 : 503,
      latencyMs,
      endpoint: cognee.endpoint,
      checkedAt,
      message: health.message,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Cognee AWS health check timed out."
        : "Cognee AWS health check could not be completed.";
    return {
      healthy: false,
      statusCode: null,
      latencyMs,
      endpoint: cognee.endpoint,
      checkedAt,
      message,
    };
  }
};
