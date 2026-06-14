import { GraphQLError } from "graphql";
import {
  startReleaseUpdatePreflightJob,
  type ReleasePreflightDeps,
} from "../../../lib/deployments/release-preflight.js";
import type { GraphQLContext } from "../../context.js";
import {
  requireDeploymentTenantAdmin,
  toReleaseUpdatePayload,
} from "./shared.js";

const SHA256_RE = /^[a-f0-9]{64}$/i;

export async function startReleaseUpdatePreflight(
  _parent: unknown,
  args: { input?: Record<string, unknown> | null },
  ctx: GraphQLContext,
  deps: ReleasePreflightDeps = {},
) {
  const { tenantId, callerUserId } = await requireDeploymentTenantAdmin(ctx);
  const input = normalizeInput(args.input);
  const { job, events } = await startReleaseUpdatePreflightJob(
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
  version: string;
  manifestUrl: string;
  manifestSha256: string;
  signatureUrl: string | null;
  signed: boolean | null;
  idempotencyKey: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GraphQLError("Release preflight input is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const record = input as Record<string, unknown>;
  const version = stringField(record, "version");
  const manifestUrl = stringField(record, "manifestUrl");
  const manifestSha256 = stringField(record, "manifestSha256").toLowerCase();
  if (!version) {
    throw new GraphQLError("Release version is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (
    !manifestUrl ||
    !/^https:\/\/.+\/thinkwork-release\.json$/i.test(manifestUrl)
  ) {
    throw new GraphQLError("Release manifest URL is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (!SHA256_RE.test(manifestSha256)) {
    throw new GraphQLError("Release manifest SHA-256 is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return {
    version,
    manifestUrl,
    manifestSha256,
    signatureUrl: stringField(record, "signatureUrl") || null,
    signed: typeof record.signed === "boolean" ? Boolean(record.signed) : null,
    idempotencyKey: stringField(record, "idempotencyKey") || null,
  };
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value.trim() : "";
}
