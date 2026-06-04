import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "./authz.js";
import { readCogneeStatus } from "./deploymentStatus.query.js";
import { resolveCallerTenantId } from "./resolve-auth-user.js";

const HEALTH_TIMEOUT_MS = 5000;

function healthUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/health`;
}

function abortSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

/**
 * knowledgeGraphHealthCheck — operator-only live probe for the private Cognee
 * endpoint. This intentionally checks only `/health`; deeper ingestion/query
 * tests belong behind future tenant-scoped Cognee API wrappers.
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

  const url = healthUrl(cognee.endpoint);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: abortSignal(HEALTH_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - startedAt;
    return {
      healthy: response.ok,
      statusCode: response.status,
      latencyMs,
      endpoint: cognee.endpoint,
      checkedAt,
      message: response.ok
        ? "Cognee health endpoint responded successfully."
        : `Cognee health endpoint returned HTTP ${response.status}.`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Cognee health check timed out."
        : "Cognee health endpoint could not be reached.";
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
