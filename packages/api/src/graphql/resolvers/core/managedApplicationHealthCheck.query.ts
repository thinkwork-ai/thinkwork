import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { requireAdminOrServiceCaller } from "./authz.js";
import {
  type ManagedApplicationKey,
  normalizeManagedApplicationKey,
  readManagedApplication,
} from "./managedApplications.js";
import { resolveCallerTenantId } from "./resolve-auth-user.js";

const MANAGED_APPLICATION_HEALTH_TIMEOUT_MS = 3500;

export const managedApplicationHealthCheck = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const tenantId = await resolveCallerTenantId(ctx);
  await requireAdminOrServiceCaller(
    ctx,
    tenantId ?? "",
    "managed_application:health_check",
  );

  const key = normalizeManagedApplicationKey(args.key);
  if (!key) {
    throw new GraphQLError("Unknown managed application key", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  return managedAppHttpHealthCheck(key, tenantId);
};

async function managedAppHttpHealthCheck(
  key: ManagedApplicationKey,
  tenantId: string | null,
) {
  const application = await readManagedApplication(key, tenantId);
  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();
  const endpoint = application.url;

  if (!application.provisioned || !endpoint) {
    return {
      key: "twenty",
      healthy: false,
      statusCode: null,
      latencyMs: 0,
      endpoint,
      checkedAt,
      message: `${application.displayName} is not provisioned for this stage.`,
    };
  }

  if (!application.runtimeEnabled) {
    return {
      key: "twenty",
      healthy: false,
      statusCode: 503,
      latencyMs: 0,
      endpoint,
      checkedAt,
      message: `${application.displayName} runtime is parked; data is retained.`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    MANAGED_APPLICATION_HEALTH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(healthUrl(endpoint), {
      method: "GET",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    return {
      key: "twenty",
      healthy: response.ok,
      statusCode: response.status,
      latencyMs,
      endpoint,
      checkedAt,
      message: response.ok
        ? `${application.displayName} /healthz is healthy.`
        : `${application.displayName} /healthz returned ${response.status}.`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `${application.displayName} health check timed out.`
        : `${application.displayName} health check could not be completed.`;
    return {
      key: "twenty",
      healthy: false,
      statusCode: null,
      latencyMs,
      endpoint,
      checkedAt,
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function healthUrl(endpoint: string, path = "/healthz"): string {
  return `${endpoint.replace(/\/+$/, "")}${path}`;
}
