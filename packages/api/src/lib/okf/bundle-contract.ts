import type { OkfPageKind } from "./page-profile.js";
import {
  validateOkfRelativePath,
  type OkfValidationResult,
} from "./page-profile.js";

export const OKF_BUNDLE_SCHEMA_VERSION = "thinkwork.okf.bundle.v1" as const;
export const OKF_CURRENT_MANIFEST_SCHEMA_VERSION =
  "thinkwork.okf.current.v1" as const;

export interface OkfBundleObject {
  path: string;
  kind: "page" | "index" | "log" | "manifest";
  pageKind?: OkfPageKind | "index" | "log";
  checksumSha256: string;
  byteLength: number;
}

export interface OkfSourceCounts {
  wikiPages: number;
  brainPages: number;
  sources: number;
  relationships: number;
}

export interface OkfSourceWatermark {
  sourceKind: "wiki" | "brain" | "graph" | "memory" | "ontology";
  maxUpdatedAt: string | null;
  count: number;
}

export interface OkfFreshnessMetadata {
  sourceWatermarks: OkfSourceWatermark[];
  staleAfter: string | null;
}

export interface OkfTraversalDirectoryIndex {
  path: string;
  indexPath: string;
  pageCount: number;
}

export interface OkfTraversalIndex {
  rootIndexPath: string;
  logPath: string | null;
  pageCount: number;
  directories: OkfTraversalDirectoryIndex[];
}

export interface OkfBundleManifest {
  schemaVersion: typeof OKF_BUNDLE_SCHEMA_VERSION;
  tenantId: string;
  tenantSlug: string;
  bundleId: string;
  generatedAt: string;
  ontologyVersion: string | null;
  checksumSha256: string;
  objectCount: number;
  byteCount: number;
  sourceCounts: OkfSourceCounts;
  freshness: OkfFreshnessMetadata;
  traversal: OkfTraversalIndex;
  objects: OkfBundleObject[];
  redaction: {
    posture: string;
    rawSourceIdsRedacted: true;
  };
}

export interface OkfCurrentManifest {
  schemaVersion: typeof OKF_CURRENT_MANIFEST_SCHEMA_VERSION;
  tenantId: string;
  tenantSlug: string;
  currentBundleId: string;
  publishedAt: string;
  bundle: {
    bundleId: string;
    checksumSha256: string;
    objectCount: number;
    byteCount: number;
    generatedAt: string;
    ontologyVersion: string | null;
    sourceCounts: OkfSourceCounts;
    freshness: OkfFreshnessMetadata;
    redactionPosture: string;
  };
}

export interface OkfOperatorManifestSummary {
  bundleId: string;
  generatedAt: string;
  ontologyVersion: string | null;
  checksumSha256: string;
  objectCount: number;
  byteCount: number;
  sourceCounts: OkfSourceCounts;
  freshness: OkfFreshnessMetadata;
  redactionPosture?: string;
}

const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/;
const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;

export function validateOkfBundleManifest(
  manifest: OkfBundleManifest,
): OkfValidationResult<OkfBundleManifest> {
  const errors: string[] = [];
  const record = asRecord(manifest);
  if (!record) return { ok: false, errors: ["manifest must be an object"] };

  requireLiteral(
    record.schemaVersion,
    OKF_BUNDLE_SCHEMA_VERSION,
    "schemaVersion",
    errors,
  );
  requireSafeId(record.tenantId, "tenantId", errors);
  requireSafeSlug(record.tenantSlug, "tenantSlug", errors);
  requireSafeId(record.bundleId, "bundleId", errors);
  requireIsoTimestamp(record.generatedAt, "generatedAt", errors);
  requireSha256(record.checksumSha256, "checksumSha256", errors);
  requirePositiveInteger(record.objectCount, "objectCount", errors);
  requireNonNegativeInteger(record.byteCount, "byteCount", errors);
  validateSourceCounts(record.sourceCounts, "sourceCounts", errors);
  validateFreshnessMetadata(record.freshness, "freshness", errors);
  validateTraversalIndex(record.traversal, "traversal", errors);

  const objects = Array.isArray(record.objects) ? record.objects : null;
  if (!objects) {
    errors.push("objects must be an array");
  } else {
    if (objects.length !== record.objectCount) {
      errors.push("objectCount must equal objects.length");
    }
    for (const [index, object] of objects.entries()) {
      validateBundleObject(object, index, errors);
    }
  }

  const redaction = asRecord(record.redaction);
  if (!redaction) {
    errors.push("redaction is required");
  } else {
    requireString(redaction.posture, "redaction.posture", errors);
    if (redaction.rawSourceIdsRedacted !== true) {
      errors.push("redaction.rawSourceIdsRedacted must be true");
    }
  }

  return errors.length === 0
    ? { ok: true, value: manifest, errors: [] }
    : { ok: false, errors };
}

export function assertValidOkfBundleManifest(
  manifest: OkfBundleManifest,
): OkfBundleManifest {
  const result = validateOkfBundleManifest(manifest);
  if (!result.ok) {
    throw new Error(`Invalid OKF bundle manifest: ${result.errors.join("; ")}`);
  }
  return manifest;
}

export function validateOkfCurrentManifest(
  manifest: OkfCurrentManifest,
): OkfValidationResult<OkfCurrentManifest> {
  const errors: string[] = [];
  const record = asRecord(manifest);
  if (!record) return { ok: false, errors: ["manifest must be an object"] };

  requireLiteral(
    record.schemaVersion,
    OKF_CURRENT_MANIFEST_SCHEMA_VERSION,
    "schemaVersion",
    errors,
  );
  requireSafeId(record.tenantId, "tenantId", errors);
  requireSafeSlug(record.tenantSlug, "tenantSlug", errors);
  requireSafeId(record.currentBundleId, "currentBundleId", errors);
  requireIsoTimestamp(record.publishedAt, "publishedAt", errors);

  const bundle = asRecord(record.bundle);
  if (!bundle) {
    errors.push("bundle is required");
  } else {
    requireSafeId(bundle.bundleId, "bundle.bundleId", errors);
    if (
      typeof record.currentBundleId === "string" &&
      typeof bundle.bundleId === "string" &&
      record.currentBundleId !== bundle.bundleId
    ) {
      errors.push("currentBundleId must match bundle.bundleId");
    }
    requireSha256(bundle.checksumSha256, "bundle.checksumSha256", errors);
    requirePositiveInteger(bundle.objectCount, "bundle.objectCount", errors);
    requireNonNegativeInteger(bundle.byteCount, "bundle.byteCount", errors);
    requireIsoTimestamp(bundle.generatedAt, "bundle.generatedAt", errors);
    if (bundle.ontologyVersion !== null) {
      requireString(bundle.ontologyVersion, "bundle.ontologyVersion", errors);
    }
    validateSourceCounts(bundle.sourceCounts, "bundle.sourceCounts", errors);
    validateFreshnessMetadata(bundle.freshness, "bundle.freshness", errors);
    requireString(bundle.redactionPosture, "bundle.redactionPosture", errors);
  }

  return errors.length === 0
    ? { ok: true, value: manifest, errors: [] }
    : { ok: false, errors };
}

export function assertValidOkfCurrentManifest(
  manifest: OkfCurrentManifest,
): OkfCurrentManifest {
  const result = validateOkfCurrentManifest(manifest);
  if (!result.ok) {
    throw new Error(
      `Invalid OKF current manifest: ${result.errors.join("; ")}`,
    );
  }
  return manifest;
}

export function summarizeOkfManifestForOperator(
  manifest: OkfBundleManifest | OkfCurrentManifest,
): OkfOperatorManifestSummary {
  if (manifest.schemaVersion === OKF_BUNDLE_SCHEMA_VERSION) {
    return {
      bundleId: manifest.bundleId,
      generatedAt: manifest.generatedAt,
      ontologyVersion: manifest.ontologyVersion,
      checksumSha256: manifest.checksumSha256,
      objectCount: manifest.objectCount,
      byteCount: manifest.byteCount,
      sourceCounts: manifest.sourceCounts,
      freshness: manifest.freshness,
      redactionPosture: manifest.redaction.posture,
    };
  }
  return {
    bundleId: manifest.bundle.bundleId,
    generatedAt: manifest.bundle.generatedAt,
    ontologyVersion: manifest.bundle.ontologyVersion,
    checksumSha256: manifest.bundle.checksumSha256,
    objectCount: manifest.bundle.objectCount,
    byteCount: manifest.bundle.byteCount,
    sourceCounts: manifest.bundle.sourceCounts,
    freshness: manifest.bundle.freshness,
    redactionPosture: manifest.bundle.redactionPosture,
  };
}

function validateBundleObject(
  value: unknown,
  index: number,
  errors: string[],
): void {
  const object = asRecord(value);
  if (!object) {
    errors.push(`objects[${index}] must be an object`);
    return;
  }
  requireOneOf(
    object.kind,
    ["page", "index", "log", "manifest"],
    `objects[${index}].kind`,
    errors,
  );
  validateBundleObjectPath(
    object.path,
    object.kind,
    `objects[${index}].path`,
    errors,
  );
  requireSha256(
    object.checksumSha256,
    `objects[${index}].checksumSha256`,
    errors,
  );
  requireNonNegativeInteger(
    object.byteLength,
    `objects[${index}].byteLength`,
    errors,
  );
}

function validateBundleObjectPath(
  path: unknown,
  kind: unknown,
  label: string,
  errors: string[],
): void {
  const pathValue = requireString(path, label, errors);
  if (!pathValue) return;

  if (kind === "manifest") {
    if (pathValue !== ".thinkwork/manifest.json") {
      errors.push(`${label} must be .thinkwork/manifest.json`);
    }
    return;
  }

  const pathResult = validateOkfRelativePath(pathValue);
  if (!pathResult.ok) {
    for (const error of pathResult.errors) {
      errors.push(error.replace(/^path/, label));
    }
  }
}

function validateFreshnessMetadata(
  value: unknown,
  label: string,
  errors: string[],
): void {
  const freshness = asRecord(value);
  if (!freshness) {
    errors.push(`${label} must be an object`);
    return;
  }

  if (freshness.staleAfter !== null) {
    requireIsoTimestamp(freshness.staleAfter, `${label}.staleAfter`, errors);
  }

  const watermarks = Array.isArray(freshness.sourceWatermarks)
    ? freshness.sourceWatermarks
    : null;
  if (!watermarks) {
    errors.push(`${label}.sourceWatermarks must be an array`);
    return;
  }
  for (const [index, watermark] of watermarks.entries()) {
    validateSourceWatermark(
      watermark,
      `${label}.sourceWatermarks[${index}]`,
      errors,
    );
  }
}

function validateSourceWatermark(
  value: unknown,
  label: string,
  errors: string[],
): void {
  const watermark = asRecord(value);
  if (!watermark) {
    errors.push(`${label} must be an object`);
    return;
  }
  requireOneOf(
    watermark.sourceKind,
    ["wiki", "brain", "graph", "memory", "ontology"],
    `${label}.sourceKind`,
    errors,
  );
  if (watermark.maxUpdatedAt !== null) {
    requireIsoTimestamp(
      watermark.maxUpdatedAt,
      `${label}.maxUpdatedAt`,
      errors,
    );
  }
  requireNonNegativeInteger(watermark.count, `${label}.count`, errors);
}

function validateTraversalIndex(
  value: unknown,
  label: string,
  errors: string[],
): void {
  const traversal = asRecord(value);
  if (!traversal) {
    errors.push(`${label} must be an object`);
    return;
  }

  validateMarkdownPath(
    traversal.rootIndexPath,
    `${label}.rootIndexPath`,
    errors,
  );
  if (traversal.logPath !== null) {
    validateMarkdownPath(traversal.logPath, `${label}.logPath`, errors);
  }
  requirePositiveInteger(traversal.pageCount, `${label}.pageCount`, errors);

  const directories = Array.isArray(traversal.directories)
    ? traversal.directories
    : null;
  if (!directories) {
    errors.push(`${label}.directories must be an array`);
    return;
  }
  for (const [index, directory] of directories.entries()) {
    validateTraversalDirectory(
      directory,
      `${label}.directories[${index}]`,
      errors,
    );
  }
}

function validateTraversalDirectory(
  value: unknown,
  label: string,
  errors: string[],
): void {
  const directory = asRecord(value);
  if (!directory) {
    errors.push(`${label} must be an object`);
    return;
  }
  validateDirectoryPath(directory.path, `${label}.path`, errors);
  validateMarkdownPath(directory.indexPath, `${label}.indexPath`, errors);
  requireNonNegativeInteger(directory.pageCount, `${label}.pageCount`, errors);
}

function validateMarkdownPath(
  path: unknown,
  label: string,
  errors: string[],
): void {
  const pathValue = requireString(path, label, errors);
  if (!pathValue) return;

  const pathResult = validateOkfRelativePath(pathValue);
  if (!pathResult.ok) {
    for (const error of pathResult.errors) {
      errors.push(error.replace(/^path/, label));
    }
  }
}

function validateDirectoryPath(
  path: unknown,
  label: string,
  errors: string[],
): void {
  const pathValue = requireString(path, label, errors);
  if (!pathValue) return;
  if (pathValue === ".") return;
  if (pathValue.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(pathValue)) {
    errors.push(`${label} must be relative`);
  }
  if (pathValue.includes("\\") || pathValue.includes("//")) {
    errors.push(`${label} must use normalized POSIX separators`);
  }
  for (const segment of pathValue.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      errors.push(`${label} contains an unsafe path segment`);
      continue;
    }
    if (segment.startsWith(".")) {
      errors.push(`${label} contains a hidden path segment`);
    }
  }
}

function validateSourceCounts(
  value: unknown,
  label: string,
  errors: string[],
): void {
  const counts = asRecord(value);
  if (!counts) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of ["wikiPages", "brainPages", "sources", "relationships"]) {
    requireNonNegativeInteger(counts[key], `${label}.${key}`, errors);
  }
}

function requireLiteral(
  value: unknown,
  expected: string,
  label: string,
  errors: string[],
): void {
  if (value !== expected) errors.push(`${label} must be ${expected}`);
}

function requireSafeId(value: unknown, label: string, errors: string[]): void {
  const id = requireString(value, label, errors);
  if (id && !SAFE_ID_RE.test(id)) errors.push(`${label} must be a safe id`);
}

function requireSafeSlug(
  value: unknown,
  label: string,
  errors: string[],
): void {
  const slug = requireString(value, label, errors);
  if (slug && !SAFE_SLUG_RE.test(slug))
    errors.push(`${label} must be a safe slug`);
}

function requireSha256(value: unknown, label: string, errors: string[]): void {
  const checksum = requireString(value, label, errors);
  if (checksum && !SHA256_RE.test(checksum)) {
    errors.push(`${label} must be a lowercase sha256 hex digest`);
  }
}

function requireIsoTimestamp(
  value: unknown,
  label: string,
  errors: string[],
): void {
  const timestamp = requireString(value, label, errors);
  if (timestamp && Number.isNaN(Date.parse(timestamp))) {
    errors.push(`${label} must be an ISO timestamp`);
  }
}

function requirePositiveInteger(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    errors.push(`${label} must be a positive integer`);
  }
}

function requireNonNegativeInteger(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (!Number.isInteger(value) || Number(value) < 0) {
    errors.push(`${label} must be a non-negative integer`);
  }
}

function requireString(
  value: unknown,
  label: string,
  errors: string[],
): string | null {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0
  ) {
    errors.push(`${label} must be a non-empty trimmed string`);
    return null;
  }
  return value;
}

function requireOneOf(
  value: unknown,
  allowed: readonly string[],
  label: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${label} must be one of ${allowed.join(", ")}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
