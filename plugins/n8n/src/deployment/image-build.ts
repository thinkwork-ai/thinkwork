import { createHash } from "node:crypto";
import {
  assertN8nPackageConfigDigest,
  normalizeN8nPackageConfig,
  type NormalizedN8nPackageConfig,
} from "../package-config";

export interface N8nPackageImageBuildInput {
  tenantId: string;
  pluginVersion: string;
  baseImageUri: string;
  taskRunnersEnabled: boolean;
  customPackageSpecs?: unknown;
  packageConfigDigest?: unknown;
  packageImageUri?: unknown;
  packageImageConfigDigest?: unknown;
}

export interface N8nPackageImageBuildContract {
  required: boolean;
  idempotencyKey: string;
  pluginVersion: string;
  tenantId: string;
  baseImageUri: string;
  baseImageDigest: string;
  taskRunnersEnabled: boolean;
  packageConfig: NormalizedN8nPackageConfig;
  nodeFunctionAllowExternal: string;
  runtimeDockerfile: string;
  taskRunnerConfigTemplate: string;
  outputImageUri: string;
  outputImageDigest: string;
  evidenceArtifacts: string[];
  security: {
    runtimeSecretsIncluded: false;
    buildSecretKeys: string[];
    allowedPackageSources: string[];
    networkEgressPolicy: string;
    iamBoundary: string;
  };
}

export function buildN8nPackageImageBuildContract(
  input: N8nPackageImageBuildInput,
): N8nPackageImageBuildContract {
  const packageConfig = normalizeN8nPackageConfig(input.customPackageSpecs);
  assertN8nPackageConfigDigest({
    expectedDigest: input.packageConfigDigest,
    actualDigest: packageConfig.digest,
    fieldName: "n8n packageConfigDigest",
  });
  assertN8nPackageConfigDigest({
    expectedDigest: input.packageImageConfigDigest,
    actualDigest: packageConfig.digest,
    fieldName: "n8n packageImageConfigDigest",
  });

  const baseImageDigest = digestFromPinnedImage(
    input.baseImageUri,
    "n8n base imageUri",
  );
  const required = packageConfig.packages.length > 0;
  if (!required && input.packageImageUri !== undefined) {
    throw new Error(
      "n8n packageImageUri requires at least one custom package spec",
    );
  }
  const outputImageUri = required
    ? digestPinnedString(input.packageImageUri, "n8n packageImageUri")
    : input.baseImageUri;
  const outputImageDigest = digestFromPinnedImage(
    outputImageUri,
    "n8n output imageUri",
  );
  const idempotencyKey = sha256Hex(
    canonicalJson({
      tenantId: input.tenantId,
      pluginVersion: input.pluginVersion,
      baseImageDigest,
      taskRunnersEnabled: input.taskRunnersEnabled,
      packageConfigDigest: packageConfig.digest,
    }),
  );

  return {
    required,
    idempotencyKey,
    pluginVersion: input.pluginVersion,
    tenantId: input.tenantId,
    baseImageUri: input.baseImageUri,
    baseImageDigest,
    taskRunnersEnabled: input.taskRunnersEnabled,
    packageConfig,
    nodeFunctionAllowExternal: packageConfig.allowExternal,
    runtimeDockerfile: "plugins/n8n/runtime/Dockerfile",
    taskRunnerConfigTemplate:
      "plugins/n8n/runtime/n8n-task-runners.json.template",
    outputImageUri,
    outputImageDigest,
    evidenceArtifacts: [
      "image-build/package-config.json",
      "image-build/build-contract.json",
      "image-build/build.log",
      "image-build/output-image-digest.txt",
    ],
    security: {
      runtimeSecretsIncluded: false,
      buildSecretKeys: [],
      allowedPackageSources: ["public-npm-registry"],
      networkEgressPolicy: "public npm registry package resolution only",
      iamBoundary:
        "deployment controller image build role scoped to ECR image push/pull, CloudWatch build logs, and deployment evidence writes",
    },
  };
}

export function n8nPackageImageBuildSummary(
  contract: N8nPackageImageBuildContract,
): Record<string, unknown> {
  return {
    required: contract.required,
    idempotencyKey: contract.idempotencyKey,
    pluginVersion: contract.pluginVersion,
    tenantId: contract.tenantId,
    baseImageDigest: contract.baseImageDigest,
    taskRunnersEnabled: contract.taskRunnersEnabled,
    packageConfigDigest: contract.packageConfig.digest,
    packageSpecs: contract.packageConfig.packageSpecs,
    packageNames: contract.packageConfig.packageNames,
    nodeFunctionAllowExternal: contract.nodeFunctionAllowExternal,
    outputImageUri: contract.outputImageUri,
    outputImageDigest: contract.outputImageDigest,
    evidenceArtifacts: contract.evidenceArtifacts,
    security: contract.security,
  };
}

function digestPinnedString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `${fieldName} is required when n8n custom packages are configured`,
    );
  }
  digestFromPinnedImage(value, fieldName);
  return value.trim();
}

function digestFromPinnedImage(imageUri: string, fieldName: string): string {
  const trimmed = imageUri.trim();
  const match = trimmed.match(/@sha256:([a-f0-9]{64})$/i);
  if (!match) {
    throw new Error(`${fieldName} must be pinned with @sha256:<digest>`);
  }
  return match[1]!.toLowerCase();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}
