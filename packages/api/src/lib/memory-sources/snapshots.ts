/**
 * Evidence snapshot S3 storage (THINK-193 U1, Codex F6).
 *
 * Normalized snapshots carry raw source content (emails, note bodies), so
 * they must NOT live inline in Postgres where analyst_reader can see them.
 * Snapshots go to the encrypted tenant brain-artifacts bucket under
 * `evidence-snapshots/…`; Postgres keeps only the `s3://` ref, the content
 * hash, and an app-side expiry that mirrors the bucket lifecycle rule
 * (30-day expiration on the `evidence-snapshots/` prefix).
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export const SNAPSHOT_PREFIX = "evidence-snapshots";
export const DEFAULT_SNAPSHOT_TTL_DAYS = 30;
export const MIN_SNAPSHOT_TTL_DAYS = 7;
export const MAX_SNAPSHOT_TTL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

// Lazy module-level default client so unit tests never construct a real
// AWS client — every entry point accepts an injected S3Client instead.
let defaultClient: S3Client | null = null;

function resolveClient(s3: S3Client | undefined): S3Client {
  if (s3) return s3;
  if (!defaultClient) defaultClient = new S3Client({});
  return defaultClient;
}

/** Test hook: replace (or clear, with null) the lazy default client. */
export function setDefaultSnapshotS3Client(client: S3Client | null): void {
  defaultClient = client;
}

/**
 * Bucket for evidence snapshots — the per-stage brain-artifacts bucket,
 * wired to the memory-stage-worker Lambda as BRAIN_ARTIFACTS_BUCKET.
 */
export function resolveSnapshotBucket(): string {
  const bucket = process.env.BRAIN_ARTIFACTS_BUCKET;
  if (!bucket) {
    throw new Error(
      "BRAIN_ARTIFACTS_BUCKET is not set — evidence snapshots require the " +
        "brain-artifacts bucket wired into the memory-stage-worker environment",
    );
  }
  return bucket;
}

/** Clamp a requested TTL to [7, 90] days; non-numeric input → 30. */
export function clampSnapshotTtlDays(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SNAPSHOT_TTL_DAYS;
  return Math.max(
    MIN_SNAPSHOT_TTL_DAYS,
    Math.min(MAX_SNAPSHOT_TTL_DAYS, Math.floor(n)),
  );
}

/** Deterministic S3 key for one evidence item version's snapshot. */
export function snapshotKeyFor(args: {
  tenantId: string;
  sourceConfigId: string;
  sourceItemId: string;
  sourceVersion: string;
}): string {
  return [
    SNAPSHOT_PREFIX,
    args.tenantId,
    args.sourceConfigId,
    encodeURIComponent(args.sourceItemId),
    `${encodeURIComponent(args.sourceVersion)}.json`,
  ].join("/");
}

/** Parse an `s3://bucket/key` snapshot ref; null when malformed. */
export function parseSnapshotRef(
  ref: string,
): { bucket: string; key: string } | null {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(ref);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
}

/**
 * Upload one normalized snapshot. Bucket-level SSE (AES256 or KMS, per
 * Terraform) applies — no per-object SSE headers, matching the other
 * brain-artifacts writers. Returns the durable ref for the evidence row
 * plus the app-side expiry matching the requested TTL.
 */
export async function putEvidenceSnapshot(
  s3: S3Client | undefined,
  args: {
    bucket: string;
    key: string;
    snapshot: Record<string, unknown>;
    ttlDays?: number;
  },
): Promise<{ ref: string; expiresAt: Date }> {
  const ttlDays = clampSnapshotTtlDays(
    args.ttlDays ?? DEFAULT_SNAPSHOT_TTL_DAYS,
  );
  await resolveClient(s3).send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
      Body: JSON.stringify(args.snapshot),
      ContentType: "application/json",
    }),
  );
  return {
    ref: `s3://${args.bucket}/${args.key}`,
    expiresAt: new Date(Date.now() + ttlDays * DAY_MS),
  };
}

/**
 * Fetch a snapshot by its `s3://` ref. Returns null when the object no
 * longer exists (lifecycle-expired) — callers treat that as "snapshot
 * unavailable", identical to a null normalized_snapshot column.
 */
export async function getEvidenceSnapshot(
  s3: S3Client | undefined,
  args: { ref: string },
): Promise<Record<string, unknown> | null> {
  const parsed = parseSnapshotRef(args.ref);
  if (!parsed) {
    throw new Error(`malformed snapshot ref (expected s3://…): ${args.ref}`);
  }
  let body: string;
  try {
    const response = await resolveClient(s3).send(
      new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
    );
    if (!response.Body) return null;
    body = await response.Body.transformToString();
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
  return JSON.parse(body) as Record<string, unknown>;
}
