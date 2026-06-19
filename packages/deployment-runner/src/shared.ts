import { createHash } from "node:crypto";
import {
  dataImpactForManagedApp,
  type ManagedAppDataImpact,
  type ManagedAppKey,
  type PreDestroyStep,
  type SmokeContract,
} from "./apps/registry.js";

export type ManagedAppOperation = "ENABLE" | "PARK" | "DESTROY" | "UPGRADE";

export const DEPLOYMENT_CONTROLLER_CONTRACT =
  "thinkwork.deployment.controller.v1";

export const DEPLOYMENT_CONTROLLER_SCHEMA_VERSION = 1;

export interface DeploymentReleaseInput {
  version?: string;
  manifestUrl?: string;
  manifestSha256?: string;
}

export interface DeploymentEvidenceInput {
  bucket?: string;
  prefix?: string;
  expectedArtifacts?: string[];
}

export interface DeploymentRunnerInput {
  phase: "plan" | "apply";
  schemaVersion?: number;
  contract?: typeof DEPLOYMENT_CONTROLLER_CONTRACT;
  action?: string;
  tenantId: string;
  jobId: string;
  sessionId?: string;
  appKey: ManagedAppKey;
  operation: ManagedAppOperation;
  releaseVersion: string;
  manifestDigest: string;
  releaseManifestUrl?: string;
  release?: DeploymentReleaseInput;
  desiredConfigVersion: string;
  desiredConfig?: Record<string, unknown>;
  manifestImages?: Record<string, string>;
  planDigest?: string;
  evidence?: DeploymentEvidenceInput;
  features?: Record<string, unknown>;
}

export interface DeploymentEvidencePointer {
  bucket: string;
  prefix: string;
}

export interface DeploymentSummary {
  jobId: string;
  appKey: ManagedAppKey;
  displayName?: string;
  operation: ManagedAppOperation;
  releaseVersion: string;
  manifestDigest: string;
  desiredConfigVersion: string;
  planDigest: string;
  dataImpact: ManagedAppDataImpact;
  terraformVariables?: Record<string, unknown>;
  preDestroySteps?: PreDestroyStep[];
  smokeContracts?: readonly SmokeContract[];
  statusOutputs?: string[];
  evidence: DeploymentEvidencePointer;
  releaseManifestUrl?: string;
  manifestImages?: Record<string, string>;
}

export function parseRunnerInput(value: unknown): DeploymentRunnerInput {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Deployment runner input must be an object");
  }
  const input = parsed as Partial<DeploymentRunnerInput>;
  if (
    input.contract !== undefined &&
    input.contract !== DEPLOYMENT_CONTROLLER_CONTRACT
  ) {
    throw new Error(
      `contract must be ${DEPLOYMENT_CONTROLLER_CONTRACT} when provided`,
    );
  }
  if (
    input.schemaVersion !== undefined &&
    input.schemaVersion !== DEPLOYMENT_CONTROLLER_SCHEMA_VERSION
  ) {
    throw new Error(
      `schemaVersion must be ${DEPLOYMENT_CONTROLLER_SCHEMA_VERSION} when provided`,
    );
  }
  assertString(input.tenantId, "tenantId");
  assertString(input.jobId, "jobId");
  normalizeRelease(input);
  assertString(input.releaseVersion, "releaseVersion");
  assertSha256(input.manifestDigest, "manifestDigest");
  assertString(input.desiredConfigVersion, "desiredConfigVersion");
  if (input.phase !== "plan" && input.phase !== "apply") {
    throw new Error("phase must be plan or apply");
  }
  if (
    input.appKey !== "cognee" &&
    input.appKey !== "n8n" &&
    input.appKey !== "plane" &&
    input.appKey !== "twenty"
  ) {
    throw new Error("appKey must be cognee, n8n, plane, or twenty");
  }
  if (
    !["ENABLE", "PARK", "DESTROY", "UPGRADE"].includes(String(input.operation))
  ) {
    throw new Error("operation must be ENABLE, PARK, DESTROY, or UPGRADE");
  }
  if (input.phase === "apply") {
    assertSha256(input.planDigest, "planDigest");
  }
  if (
    input.desiredConfig !== undefined &&
    (!input.desiredConfig ||
      typeof input.desiredConfig !== "object" ||
      Array.isArray(input.desiredConfig))
  ) {
    throw new Error("desiredConfig must be an object when provided");
  }
  if (input.manifestImages !== undefined) {
    validateManifestImages(input.manifestImages);
  }
  if (input.evidence !== undefined) {
    validateEvidence(input.evidence);
  }
  return input as DeploymentRunnerInput;
}

export function manifestDigestMatches(args: {
  expectedDigest: string;
  actualDigest: string;
}): boolean {
  assertSha256(args.expectedDigest, "expectedDigest");
  assertSha256(args.actualDigest, "actualDigest");
  return args.expectedDigest.toLowerCase() === args.actualDigest.toLowerCase();
}

export function stablePlanDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function evidencePointer(args: {
  bucket: string;
  tenantId: string;
  appKey: string;
  jobId: string;
  phase: "plan" | "apply";
}): DeploymentEvidencePointer {
  assertString(args.bucket, "bucket");
  return {
    bucket: args.bucket,
    prefix: [
      sanitizePathPart(args.tenantId),
      sanitizePathPart(args.appKey),
      sanitizePathPart(args.jobId),
      args.phase,
    ].join("/"),
  };
}

export function evidencePointerForInput(args: {
  input: DeploymentRunnerInput;
  fallbackBucket: string;
  phase: "plan" | "apply";
}): DeploymentEvidencePointer {
  const bucket = args.input.evidence?.bucket ?? args.fallbackBucket;
  const prefix = args.input.evidence?.prefix;
  if (bucket && prefix) {
    return { bucket, prefix };
  }
  return evidencePointer({
    bucket,
    tenantId: args.input.tenantId,
    appKey: args.input.appKey,
    jobId: args.input.jobId,
    phase: args.phase,
  });
}

export function dataImpactFor(
  appKey: ManagedAppKey,
  operation: ManagedAppOperation,
): ManagedAppDataImpact {
  return dataImpactForManagedApp(appKey, operation);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
}

function assertSha256(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${field} must be a sha256 hex digest`);
  }
}

function normalizeRelease(input: Partial<DeploymentRunnerInput>): void {
  const release = input.release;
  if (release !== undefined) {
    if (!release || typeof release !== "object" || Array.isArray(release)) {
      throw new Error("release must be an object when provided");
    }
    if (release.version !== undefined) {
      assertString(release.version, "release.version");
      if (input.releaseVersion && input.releaseVersion !== release.version) {
        throw new Error("release.version must match releaseVersion");
      }
      input.releaseVersion = release.version;
    }
    if (release.manifestSha256 !== undefined) {
      assertSha256(release.manifestSha256, "release.manifestSha256");
      if (
        input.manifestDigest &&
        input.manifestDigest.toLowerCase() !==
          release.manifestSha256.toLowerCase()
      ) {
        throw new Error("release.manifestSha256 must match manifestDigest");
      }
      input.manifestDigest = release.manifestSha256;
    }
    if (release.manifestUrl !== undefined) {
      assertString(release.manifestUrl, "release.manifestUrl");
      if (
        input.releaseManifestUrl &&
        input.releaseManifestUrl !== release.manifestUrl
      ) {
        throw new Error("release.manifestUrl must match releaseManifestUrl");
      }
      input.releaseManifestUrl = release.manifestUrl;
    }
  }
}

function validateManifestImages(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("manifestImages must be an object when provided");
  }
  for (const [name, imageUri] of Object.entries(value)) {
    assertString(name, "manifestImages key");
    assertString(imageUri, `manifestImages.${name}`);
    if (!/@sha256:[0-9a-f]{64}$/i.test(imageUri)) {
      throw new Error(
        `manifestImages.${name} must be pinned to an immutable sha256 digest`,
      );
    }
  }
}

function validateEvidence(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("evidence must be an object when provided");
  }
  const evidence = value as DeploymentEvidenceInput;
  if (evidence.bucket !== undefined)
    assertString(evidence.bucket, "evidence.bucket");
  if (evidence.prefix !== undefined)
    assertString(evidence.prefix, "evidence.prefix");
  if (
    evidence.expectedArtifacts !== undefined &&
    (!Array.isArray(evidence.expectedArtifacts) ||
      evidence.expectedArtifacts.some((entry) => typeof entry !== "string"))
  ) {
    throw new Error("evidence.expectedArtifacts must be a string array");
  }
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._=-]/g, "_").slice(0, 120);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}
