/**
 * Conformance judge sweeper (THINK-189 U4/KTD4).
 *
 * Scheduled Lambda (rate ~2 min, reserved concurrency 1 — the
 * compliance-outbox-drainer pattern) that claims document conformance
 * reports with judge_status = 'pending' and scores each with one Bedrock
 * Converse call. Direct process-and-complete — no in-flight status (the
 * table's CHECK constraint allows exactly pending|complete|error|skipped;
 * single-writer via reserved concurrency makes the simple form safe).
 *
 * Retry semantics: the sweeper's own next tick is the retry. Claiming a
 * row increments judge_attempts in the same conditional UPDATE, so a crash
 * mid-batch still counts the attempt; throttles leave the row pending;
 * non-retryable errors mark it error; rows past the attempt cap are marked
 * error instead of re-processed, so poison rows can't loop forever.
 */

import { getDb } from "@thinkwork/database-pg";
import { documentConformanceReports } from "@thinkwork/database-pg/schema";
import { eq, sql } from "drizzle-orm";
import {
  invokeConformanceJudge,
  resolveConformanceJudgeModelId,
  type ConformanceJudgeVerdict,
} from "../lib/artifacts/conformance-judge.js";
import type { ConformanceManifestSnapshot } from "../lib/artifacts/document-conformance.js";
import {
  artifactContentKey,
  readArtifactPayloadFromS3,
} from "../lib/artifacts/payload-storage.js";
import { isRetryableEvalInfrastructureError } from "../lib/evals/retryable.js";

const BATCH_SIZE = parseInt(
  process.env.CONFORMANCE_JUDGE_BATCH_SIZE || "10",
  10,
);
/** Attempts INCLUDING the current one; a row claimed past this caps out. */
const MAX_ATTEMPTS = parseInt(
  process.env.CONFORMANCE_JUDGE_MAX_ATTEMPTS || "5",
  10,
);
const ERROR_MESSAGE_MAX_CHARS = 500;

export interface PendingConformanceReport {
  id: string;
  tenantId: string;
  artifactId: string;
  digestRevision: string;
  manifestSnapshot: ConformanceManifestSnapshot;
  /** Attempt count AFTER the claim increment (this attempt included). */
  judgeAttempts: number;
}

/** Injectable seams so tests exercise the sweep without a live DB/S3/Bedrock. */
export interface ConformanceJudgeSweepDeps {
  /**
   * Claim up to `batchSize` pending rows oldest-first, incrementing
   * judge_attempts in the same statement (crash-safe attempt counting).
   */
  claimPendingBatch: (batchSize: number) => Promise<PendingConformanceReport[]>;
  loadDigest: (report: PendingConformanceReport) => Promise<string>;
  invokeJudge: (input: {
    modelId: string;
    digestMarkdown: string;
    manifestSnapshot: ConformanceManifestSnapshot;
    costContext?: { tenantId: string; requestId: string };
  }) => Promise<ConformanceJudgeVerdict>;
  markComplete: (
    id: string,
    result: { model: string; findings: ConformanceJudgeVerdict },
  ) => Promise<void>;
  markError: (id: string, message: string) => Promise<void>;
  /** Throttled: return the claimed row to pending for the next tick. */
  releaseToPending: (id: string) => Promise<void>;
}

function defaultDeps(): ConformanceJudgeSweepDeps {
  return {
    claimPendingBatch: async (batchSize) => {
      const db = getDb();
      const claimed = await db
        .update(documentConformanceReports)
        .set({
          judge_attempts: sql`${documentConformanceReports.judge_attempts} + 1`,
        })
        .where(
          sql`${documentConformanceReports.id} IN (
            SELECT id FROM ${documentConformanceReports}
            WHERE ${documentConformanceReports.judge_status} = 'pending'
            ORDER BY ${documentConformanceReports.created_at} ASC
            LIMIT ${batchSize}
          )`,
        )
        .returning({
          id: documentConformanceReports.id,
          tenant_id: documentConformanceReports.tenant_id,
          artifact_id: documentConformanceReports.artifact_id,
          digest_revision: documentConformanceReports.digest_revision,
          manifest_snapshot: documentConformanceReports.manifest_snapshot,
          judge_attempts: documentConformanceReports.judge_attempts,
          created_at: documentConformanceReports.created_at,
        });
      return claimed
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .map((row) => ({
          id: row.id,
          tenantId: row.tenant_id,
          artifactId: row.artifact_id,
          digestRevision: row.digest_revision,
          manifestSnapshot:
            row.manifest_snapshot as ConformanceManifestSnapshot,
          judgeAttempts: row.judge_attempts,
        }));
    },
    loadDigest: (report) =>
      readArtifactPayloadFromS3({
        tenantId: report.tenantId,
        key: artifactContentKey({
          tenantId: report.tenantId,
          artifactId: report.artifactId,
          revision: report.digestRevision,
        }),
      }),
    invokeJudge: invokeConformanceJudge,
    markComplete: async (id, result) => {
      await getDb()
        .update(documentConformanceReports)
        .set({
          judge_status: "complete",
          judge_model: result.model,
          judge_findings: result.findings,
          judge_completed_at: new Date(),
          judge_error: null,
        })
        .where(eq(documentConformanceReports.id, id));
    },
    markError: async (id, message) => {
      await getDb()
        .update(documentConformanceReports)
        .set({
          judge_status: "error",
          judge_error: message.slice(0, ERROR_MESSAGE_MAX_CHARS),
        })
        .where(eq(documentConformanceReports.id, id));
    },
    releaseToPending: async () => {
      // Rows claimed by the attempt-increment UPDATE stay judge_status =
      // 'pending' throughout — nothing to undo; the next tick re-claims.
    },
  };
}

export interface ConformanceJudgeSweepResult {
  claimed: number;
  completed: number;
  errored: number;
  deferred: number;
}

export async function sweepConformanceReports(
  deps: ConformanceJudgeSweepDeps = defaultDeps(),
  options: { batchSize?: number; maxAttempts?: number } = {},
): Promise<ConformanceJudgeSweepResult> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const modelId = resolveConformanceJudgeModelId();

  const batch = await deps.claimPendingBatch(batchSize);
  const result: ConformanceJudgeSweepResult = {
    claimed: batch.length,
    completed: 0,
    errored: 0,
    deferred: 0,
  };

  for (const report of batch) {
    if (report.judgeAttempts > maxAttempts) {
      await deps.markError(
        report.id,
        `judge attempt cap reached (${maxAttempts})`,
      );
      result.errored += 1;
      continue;
    }
    try {
      const digestMarkdown = await deps.loadDigest(report);
      const findings = await deps.invokeJudge({
        modelId,
        digestMarkdown,
        manifestSnapshot: report.manifestSnapshot,
        // THINK-245 U6: per-tenant cost attribution. The attempt count is
        // part of the idempotency key so a retried report (each attempt is
        // real Bedrock spend) isn't conflict-dropped by (request_id,
        // event_type) uniqueness.
        costContext: {
          tenantId: report.tenantId,
          requestId: `judge:${report.artifactId}:${report.digestRevision}:a${report.judgeAttempts}`,
        },
      });
      await deps.markComplete(report.id, { model: modelId, findings });
      result.completed += 1;
    } catch (err) {
      if (isRetryableEvalInfrastructureError(err)) {
        // Throttle: the row stays pending; the next tick retries (AE4).
        await deps.releaseToPending(report.id);
        result.deferred += 1;
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      await deps.markError(report.id, message);
      result.errored += 1;
    }
  }

  console.log(
    `[document-conformance-judge] claimed=${result.claimed} completed=${result.completed} errored=${result.errored} deferred=${result.deferred}`,
  );
  return result;
}

export async function handler(): Promise<ConformanceJudgeSweepResult> {
  return sweepConformanceReports();
}
