import { GraphQLError } from "graphql";
import {
  remediateReleaseRunnerJob,
  type ReleasePreflightDeps,
} from "../../../lib/deployments/release-preflight.js";
import type { GraphQLContext } from "../../context.js";
import {
  requireDeploymentTenantAdmin,
  toReleaseUpdatePayload,
} from "./shared.js";

export async function remediateReleaseRunner(
  _parent: unknown,
  args: { input?: Record<string, unknown> | null },
  ctx: GraphQLContext,
  deps: ReleasePreflightDeps = {},
) {
  const { tenantId, callerUserId } = await requireDeploymentTenantAdmin(ctx);
  const input = normalizeInput(args.input);
  const { job, events } = await remediateReleaseRunnerJob(
    {
      tenantId,
      requestedByUserId: callerUserId,
      ...input,
    },
    deps,
  );
  return toReleaseUpdatePayload(job, events);
}

function normalizeInput(input: unknown): {
  jobId: string;
  idempotencyKey: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GraphQLError("Runner remediation input is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const record = input as Record<string, unknown>;
  const jobId = stringField(record, "jobId");
  if (!jobId) {
    throw new GraphQLError("Release update job ID is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return {
    jobId,
    idempotencyKey: stringField(record, "idempotencyKey") || null,
  };
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value.trim() : "";
}
