import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "./authz.js";
import { resolveCallerTenantId } from "./resolve-auth-user.js";

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
  return {
    stage: process.env.STAGE || "unknown",
    source: "AWS",
    region: process.env.AWS_REGION || "us-east-1",
    accountId: process.env.AWS_ACCOUNT_ID || null,
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
  };
};
