import { GraphQLError } from "graphql";
import { startManagedApplicationPlanJob } from "../../../lib/deployments/start-plan-job.js";
import type { GraphQLContext } from "../../context.js";
import {
  normalizeDeploymentOperation,
  normalizeManagedAppKey,
  parseAwsJsonObject,
  requireDeploymentTenantAdmin,
  toDeploymentPayload,
  type DeploymentDeps,
} from "./shared.js";

export async function startManagedApplicationPlan(
  _parent: unknown,
  args: { input: Record<string, unknown> },
  ctx: GraphQLContext,
  deps: DeploymentDeps = {},
) {
  const { tenantId, callerUserId } = await requireDeploymentTenantAdmin(ctx);
  const appKey = normalizeManagedAppKey(args.input.key);
  const operation = normalizeDeploymentOperation(args.input.operation);
  const idempotencyKey = String(args.input.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    throw new GraphQLError("idempotencyKey is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  // Job creation runs through the shared core (lib/deployments/start-plan-job)
  // so plugin-infra-created jobs and admin-started jobs are indistinguishable.
  const { job, events } = await startManagedApplicationPlanJob(
    {
      tenantId,
      requestedByUserId: callerUserId,
      appKey,
      operation,
      idempotencyKey,
      releaseVersion:
        typeof args.input.releaseVersion === "string" &&
        args.input.releaseVersion
          ? args.input.releaseVersion
          : null,
      manifestDigest:
        typeof args.input.manifestDigest === "string" &&
        args.input.manifestDigest
          ? args.input.manifestDigest
          : null,
      releaseManifestUrl:
        typeof args.input.manifestUrl === "string" && args.input.manifestUrl
          ? args.input.manifestUrl
          : null,
      desiredConfigVersion:
        typeof args.input.desiredConfigVersion === "string" &&
        args.input.desiredConfigVersion
          ? args.input.desiredConfigVersion
          : null,
      desiredConfig: parseAwsJsonObject(args.input.desiredConfig),
      manifestImages: parseManifestImages(args.input.manifestImages),
    },
    deps,
  );
  return toDeploymentPayload(job, events);
}

function parseManifestImages(value: unknown): Record<string, string> {
  const parsed = parseAwsJsonObject(value);
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
