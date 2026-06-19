import { createHash } from "node:crypto";
import {
  validateExtractContract,
  type ContractValidationIssue,
  type LakeHouseExtractContract,
} from "./extract-contract";
import type { LakeHouseRunnerPolicy } from "./policy-contract";

export interface LakeHouseBundleManifest {
  schemaVersion: 1;
  pluginKey: "lakehouse";
  integrationKey: string;
  bundleVersion: string;
  sourceCommit: string;
  approvedBy: string;
  approvedAt: string;
  meltanoProject: MeltanoProjectContract;
  extracts: LakeHouseExtractContract[];
  policy: LakeHouseRunnerPolicy;
  signature: BundleSignatureMetadata;
}

export interface MeltanoProjectContract {
  meltanoVersion: string;
  files: Array<{
    path: string;
    sha256: string;
  }>;
  jobs: Array<{
    name: string;
    tasks: string[];
  }>;
  environments: string[];
  plugins: Array<{
    name: string;
    variant?: string;
    pipUrl?: string;
    version?: string;
    resolvedVersion?: string;
  }>;
  requiredRuntimeVariables: Array<{
    name: string;
    secretRef: string;
  }>;
}

export interface BundleSignatureMetadata {
  algorithm: "sha256" | "sha256-rsa" | "sha256-kms";
  digest: string;
  signatureRef: string;
  signedBy: string;
  signedAt: string;
}

export interface BundleValidationResult {
  ok: boolean;
  digest: string;
  issues: ContractValidationIssue[];
}

const SECRET_VALUE_PATTERNS = [
  /password\s*[:=]\s*[^,\s}]+/i,
  /secret\s*[:=]\s*[^,\s}]+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b[A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*\s*[:=]\s*[^,\s}]+/i,
] as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as any)[key])}`,
    )
    .join(",")}}`;
}

export function computeBundleDigest(manifest: LakeHouseBundleManifest): string {
  const unsigned = {
    ...manifest,
    signature: { ...manifest.signature, digest: "" },
  };
  return createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
}

export function validateBundleManifest(
  manifest: LakeHouseBundleManifest,
): BundleValidationResult {
  const issues: ContractValidationIssue[] = [];

  if (manifest.schemaVersion !== 1) {
    issues.push({
      path: "schemaVersion",
      message: "Only schema version 1 is supported",
    });
  }
  if (manifest.pluginKey !== "lakehouse") {
    issues.push({
      path: "pluginKey",
      message: "Bundle must preserve the lakehouse plugin identity",
    });
  }
  for (const field of [
    "integrationKey",
    "bundleVersion",
    "sourceCommit",
    "approvedBy",
    "approvedAt",
  ] as const) {
    if (!manifest[field] || typeof manifest[field] !== "string") {
      issues.push({
        path: field,
        message: "Required bundle metadata must be a non-empty string",
      });
    }
  }

  if (!manifest.signature?.digest || !manifest.signature.signatureRef) {
    issues.push({
      path: "signature",
      message: "Digest and signature reference are required",
    });
  }

  if (
    !manifest.meltanoProject?.files?.some((file) => file.path === "meltano.yml")
  ) {
    issues.push({
      path: "meltanoProject.files",
      message: "Bundle must include meltano.yml",
    });
  }
  if (!manifest.meltanoProject?.plugins?.length) {
    issues.push({
      path: "meltanoProject.plugins",
      message: "Connector/runtime plugin versions must be pinned or recorded",
    });
  }
  for (const [index, runtimeVar] of (
    manifest.meltanoProject?.requiredRuntimeVariables ?? []
  ).entries()) {
    if (!runtimeVar.secretRef || runtimeVar.secretRef === runtimeVar.name) {
      issues.push({
        path: `meltanoProject.requiredRuntimeVariables.${index}.secretRef`,
        message:
          "Runtime secrets must be represented by references, not values",
      });
    }
  }

  for (const [index, extract] of (manifest.extracts ?? []).entries()) {
    issues.push(
      ...validateExtractContract(extract, `extracts.${index}`).issues,
    );
  }
  if (!manifest.extracts?.length) {
    issues.push({
      path: "extracts",
      message: "At least one extract contract is required",
    });
  }

  const serialized = JSON.stringify(manifest);
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(serialized))) {
    issues.push({
      path: "bundle",
      message: "Bundle contains secret-looking values",
    });
  }

  const digest = computeBundleDigest(manifest);
  if (manifest.signature?.digest && manifest.signature.digest !== digest) {
    issues.push({
      path: "signature.digest",
      message: "Manifest digest does not match canonical bundle contents",
    });
  }

  return { ok: issues.length === 0, digest, issues };
}

export function withComputedBundleDigest(
  manifest: LakeHouseBundleManifest,
): LakeHouseBundleManifest {
  const digest = computeBundleDigest(manifest);
  return {
    ...manifest,
    signature: {
      ...manifest.signature,
      digest,
    },
  };
}
