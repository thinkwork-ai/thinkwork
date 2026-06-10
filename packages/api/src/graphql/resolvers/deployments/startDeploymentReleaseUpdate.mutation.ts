import { randomUUID } from "node:crypto";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  defaultStartExecution,
  deploymentEvidenceBucket,
  requireDeploymentTenantAdmin,
  resolveDeploymentControllerConfig,
  type DeploymentDeps,
} from "./shared.js";
import type { DeploymentRelease } from "./deploymentReleases.query.js";

const CONTROLLER_CONTRACT = "thinkwork.deployment.controller.v1";
const CONTROLLER_SCHEMA_VERSION = 1;
const SHA256_RE = /^[a-f0-9]{64}$/i;

export async function startDeploymentReleaseUpdate(
  _parent: unknown,
  args: {
    input?: {
      version?: unknown;
      manifestUrl?: unknown;
      manifestSha256?: unknown;
      idempotencyKey?: unknown;
    } | null;
  },
  ctx: GraphQLContext,
  deps: DeploymentDeps = {},
) {
  await requireDeploymentTenantAdmin(ctx);
  const input = normalizeInput(args.input);
  const controllerConfig = await (
    deps.resolveDeploymentControllerConfig ?? resolveDeploymentControllerConfig
  )();
  const stateMachineArn = controllerConfig.stateMachineArn;
  if (!stateMachineArn) {
    throw new GraphQLError("Deployment controller is not configured", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }

  const runId = randomUUID();
  const evidenceBucket =
    controllerConfig.evidenceBucket ?? deploymentEvidenceBucket();
  const evidencePrefix = `settings/releases/${input.version}/${runId}`;
  const release = toRelease(input);
  const startExecution = deps.startExecution ?? defaultStartExecution;
  const payload = buildControllerPayload({
    action: "update",
    runId,
    release,
    evidenceBucket,
    evidencePrefix,
  });
  const execution = await startExecution({
    stateMachineArn,
    name: `tw-update-${runId.replace(/-/g, "").slice(0, 48)}`,
    payload,
  });

  return {
    release,
    executionArn: execution.executionArn,
    stateMachineArn,
    evidenceBucket,
    evidencePrefix,
    message: `Deployment update requested for ${input.version}.`,
  };
}

function normalizeInput(input: unknown): {
  version: string;
  manifestUrl: string;
  manifestSha256: string;
  idempotencyKey: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GraphQLError("Release update input is required", {
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
    idempotencyKey: stringField(record, "idempotencyKey") || null,
  };
}

function toRelease(input: {
  version: string;
  manifestUrl: string;
  manifestSha256: string;
}): DeploymentRelease {
  return {
    version: input.version,
    name: input.version,
    prerelease: input.version.includes("canary"),
    draft: false,
    publishedAt: null,
    htmlUrl: `https://github.com/${releaseRepository()}/releases/tag/${encodeURIComponent(input.version)}`,
    manifestUrl: input.manifestUrl,
    manifestSha256: input.manifestSha256,
    signatureUrl: null,
    signed: false,
    deployable: true,
  };
}

function buildControllerPayload(args: {
  action: "update";
  runId: string;
  release: DeploymentRelease;
  evidenceBucket: string | null;
  evidencePrefix: string;
}) {
  const stage = process.env.STAGE || "unknown";
  const region = process.env.AWS_REGION || "us-east-1";
  const accountId = process.env.AWS_ACCOUNT_ID || "";
  return {
    schemaVersion: CONTROLLER_SCHEMA_VERSION,
    contract: CONTROLLER_CONTRACT,
    phase: "update",
    action: args.action,
    sessionId: args.runId,
    customerName: process.env.THINKWORK_DEPLOYMENT_DISPLAY_NAME || "ThinkWork",
    environmentName: stage,
    awsAccountId: accountId,
    awsRegion: region,
    availabilityZones: [],
    source: "settings",
    evidenceBucket: args.evidenceBucket,
    evidence: {
      bucket: args.evidenceBucket,
      prefix: args.evidencePrefix,
      expectedArtifacts: [
        "controller-input-summary.json",
        "redacted-terraform-vars.json",
        "terraform-plan.json",
        "terraform-outputs.json",
        "deployment-evidence.json",
      ],
    },
    releaseVersion: args.release.version,
    releaseManifestUrl: args.release.manifestUrl,
    releaseManifestSha256: args.release.manifestSha256,
    terraformModuleVersion: releaseVersionToTerraformModuleVersion(
      args.release.version,
    ),
    release: {
      version: args.release.version,
      manifestUrl: args.release.manifestUrl,
      manifestSha256: args.release.manifestSha256,
    },
    operation: {
      kind: "foundation",
      action: args.action,
      plan: true,
      apply: true,
      destroy: false,
    },
    features: {
      baseInstall: {
        cognee: false,
        slack: false,
        stripe: false,
        twenty: false,
      },
      optionalApps: [],
    },
    terraform: {
      stateRecovery: {
        mode: "state",
        recoverByTags: false,
      },
    },
  };
}

function releaseRepository(): string {
  return process.env.THINKWORK_RELEASE_REPOSITORY || "thinkwork-ai/thinkwork";
}

function releaseVersionToTerraformModuleVersion(version: string): string {
  return version.replace(/^v/, "");
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value.trim() : "";
}
