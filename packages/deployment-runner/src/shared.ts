import { createHash } from "node:crypto";
import {
  dataImpactForManagedApp,
  type ManagedAppDataImpact,
  type ManagedAppKey,
  type PreDestroyStep,
  type SmokeContract,
} from "./apps/registry.js";

export type ManagedAppOperation = "ENABLE" | "PARK" | "DESTROY" | "UPGRADE";

export interface DeploymentRunnerInput {
  phase: "plan" | "apply";
  tenantId: string;
  jobId: string;
  appKey: ManagedAppKey;
  operation: ManagedAppOperation;
  releaseVersion: string;
  manifestDigest: string;
  desiredConfigVersion: string;
  desiredConfig?: Record<string, unknown>;
  planDigest?: string;
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
}

export function parseRunnerInput(value: unknown): DeploymentRunnerInput {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Deployment runner input must be an object");
  }
  const input = parsed as Partial<DeploymentRunnerInput>;
  assertString(input.tenantId, "tenantId");
  assertString(input.jobId, "jobId");
  assertString(input.releaseVersion, "releaseVersion");
  assertSha256(input.manifestDigest, "manifestDigest");
  assertString(input.desiredConfigVersion, "desiredConfigVersion");
  if (input.phase !== "plan" && input.phase !== "apply") {
    throw new Error("phase must be plan or apply");
  }
  if (
    input.appKey !== "cognee" &&
    input.appKey !== "kestra" &&
    input.appKey !== "twenty"
  ) {
    throw new Error("appKey must be cognee, kestra, or twenty");
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
