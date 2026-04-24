/**
 * plugin-staging-sweeper — hourly cleanup of orphan S3 staging prefixes
 * (plan §U10 Approach + §Sweeper).
 *
 * A plugin upload writes `plugin_uploads.status='staging'` + an S3 prefix
 * in phase 1 of the saga. Phase 3 flips it to `'installed'` (happy path)
 * or `'failed'` (any phase failure). If the Lambda crashes between phases
 * the row stays `'staging'` with the S3 objects still present and costing
 * money. This sweeper finds rows older than `STAGING_MAX_AGE_MINUTES`
 * still in `'staging'`, deletes their S3 prefixes, and marks the rows
 * `'failed'` with a `'sweeper: staging exceeded 1h'` error_message.
 *
 * Triggered by an EventBridge schedule; no HTTP surface. The sweeper is
 * safe to re-run — the UPDATE only touches rows still in `'staging'`, so
 * a row the saga just finished won't get flipped. The `DeleteObjects`
 * call silently no-ops when the prefix is already empty.
 *
 * Design notes:
 *   - 1-hour window is conservative. The full install saga is <30 s on a
 *     50 MB zip; anything still staging after 1h is abandoned.
 *   - We list S3 objects under each staging prefix and batch-delete
 *     (up to 1000 per DeleteObjects call). Typical prefix has one file
 *     (bundle.zip) but the code handles arbitrary counts for safety.
 *   - Returning the counts makes the result observable via CloudWatch
 *     Insights + lets tests assert cleanup without touching S3.
 */

import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq, inArray, lt } from "drizzle-orm";

import { getDb } from "@thinkwork/database-pg";
import { pluginUploads } from "@thinkwork/database-pg/schema";

const STAGING_MAX_AGE_MINUTES = 60;
const SWEEPER_ERROR_MESSAGE = "sweeper: staging exceeded 1h";

export interface SweepResult {
  sweptAt: string;
  cutoff: string;
  orphans: number;
  deleted_keys: number;
  rows_marked_failed: number;
  rows: Array<{
    id: string;
    tenant_id: string;
    s3_staging_prefix: string | null;
    deleted_key_count: number;
  }>;
}

function workspaceBucket(): string {
  return process.env.WORKSPACE_BUCKET || "";
}

export async function handler(): Promise<SweepResult> {
  const bucket = workspaceBucket();
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET env is not configured");
  }

  const s3 = new S3Client({});
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(now.getTime() - STAGING_MAX_AGE_MINUTES * 60 * 1000);

  const orphans = await db
    .select({
      id: pluginUploads.id,
      tenant_id: pluginUploads.tenant_id,
      s3_staging_prefix: pluginUploads.s3_staging_prefix,
    })
    .from(pluginUploads)
    .where(
      and(
        eq(pluginUploads.status, "staging"),
        lt(pluginUploads.uploaded_at, cutoff),
      ),
    );

  const perRow: SweepResult["rows"] = [];
  let totalDeleted = 0;

  for (const orphan of orphans) {
    const deleted_key_count = orphan.s3_staging_prefix
      ? await deletePrefix(s3, bucket, orphan.s3_staging_prefix)
      : 0;
    totalDeleted += deleted_key_count;
    perRow.push({
      id: orphan.id,
      tenant_id: orphan.tenant_id,
      s3_staging_prefix: orphan.s3_staging_prefix,
      deleted_key_count,
    });
  }

  let rowsMarkedFailed = 0;
  if (orphans.length > 0) {
    const ids = orphans.map((o) => o.id);
    const updated = await db
      .update(pluginUploads)
      .set({
        status: "failed",
        error_message: SWEEPER_ERROR_MESSAGE,
      })
      .where(
        and(
          inArray(pluginUploads.id, ids),
          eq(pluginUploads.status, "staging"),
        ),
      )
      .returning({ id: pluginUploads.id });
    rowsMarkedFailed = updated.length;
  }

  const result: SweepResult = {
    sweptAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    orphans: orphans.length,
    deleted_keys: totalDeleted,
    rows_marked_failed: rowsMarkedFailed,
    rows: perRow,
  };

  if (orphans.length > 0) {
    console.log(
      `[plugin-staging-sweeper] orphans=${orphans.length} deleted_keys=${totalDeleted} ` +
        `rows_marked_failed=${rowsMarkedFailed} cutoff=${result.cutoff}`,
      JSON.stringify(perRow),
    );
  } else {
    console.log(
      `[plugin-staging-sweeper] no orphan staging rows; cutoff=${result.cutoff}`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

/** List + batch-delete all keys under `prefix`. Returns the count deleted. */
async function deletePrefix(
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<number> {
  let continuationToken: string | undefined;
  let deleted = 0;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys =
      list.Contents?.map((obj) => obj.Key).filter(
        (k): k is string => typeof k === "string",
      ) ?? [];
    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: keys.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      deleted += keys.length;
    }
    continuationToken = list.IsTruncated
      ? list.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return deleted;
}
