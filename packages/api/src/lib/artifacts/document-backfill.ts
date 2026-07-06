/**
 * Document Compositor v2 (THINK-154 U6): corpus backfill core — recompile
 * existing document artifacts' digests through the compositor (R11/R12).
 *
 * KTD6: for `final` documents the backfill must BOTH overwrite the
 * overwrite-in-place head render key (readers serve documents from the head;
 * a pin-only backfill would record the new version while every document keeps
 * displaying the stale legacy HTML) AND pin the new version through the
 * guarded pin path. Pinned versions are never mutated — the prior render
 * stays in version history.
 *
 * Drafts carry no version history, so an overwrite is irrecoverable: they are
 * skipped by default; `includeDrafts` opts them in and snapshots the existing
 * render to a backup key BEFORE overwriting. No version row is created for
 * drafts.
 *
 * Pure core with an injected store so the loop is unit-testable; the operator
 * script (scripts/backfill-document-renders.ts) provides the live store.
 */

import { compileDocument } from "./document-compositor.js";
import {
  DocumentEmissionConflict,
  DOCUMENT_GENRES,
  type DocumentGenre,
  type DocumentRow,
} from "./document-emission.js";
import { runDocumentPreflight } from "./document-preflight.js";

export interface BackfillDocumentRow extends DocumentRow {
  title: string;
  /** artifacts.type — the document genre. */
  type: string;
  summary: string | null;
}

export interface DocumentBackfillStore {
  /** All document-kind artifact rows in scope (already tenant-filtered). */
  listDocuments(): Promise<BackfillDocumentRow[]>;
  /** Read the digest head (content.md) for a row. */
  readDigest(row: BackfillDocumentRow): Promise<string>;
  /** Overwrite the head render key (render.html) with compiled output. */
  writeRenderHead(row: BackfillDocumentRow, renderHtml: string): Promise<void>;
  /** Snapshot the CURRENT head render to the backup key (drafts only). */
  snapshotRender(row: BackfillDocumentRow, runId: string): Promise<void>;
  /**
   * Pin the new version through the guarded pin path (write-once pin keys +
   * version row + head_write_seq CAS). Throws DocumentEmissionConflict on a
   * concurrent head write.
   */
  pinHead(
    row: BackfillDocumentRow,
    digestMarkdown: string,
    renderHtml: string,
  ): Promise<{ headVersion: number; pinned: boolean }>;
  /** Re-read one row (conflict retry). Null if the row vanished. */
  reloadRow(row: BackfillDocumentRow): Promise<BackfillDocumentRow | null>;
}

export interface DocumentBackfillOptions {
  dryRun: boolean;
  includeDrafts: boolean;
  /** Canary batch: process at most N documents, report the remainder. */
  limit?: number;
  /** Stamps the draft snapshot key; operator-supplied (e.g. a timestamp). */
  runId: string;
  /** Per-document work runs in a pool of this size (default 1: sequential). */
  concurrency?: number;
  log?: (line: string) => void;
}

export interface DocumentBackfillReport {
  total: number;
  processed: number;
  pinnedFinals: number;
  overwrittenDrafts: number;
  skippedDrafts: number;
  skippedNonGenre: number;
  compileFailures: Array<{ artifactId: string; codes: string[] }>;
  conflicts: string[];
  unprocessed: number;
  dryRun: boolean;
}

export async function runDocumentBackfill(
  store: DocumentBackfillStore,
  opts: DocumentBackfillOptions,
): Promise<DocumentBackfillReport> {
  const log = opts.log ?? (() => {});
  const rows = await store.listDocuments();
  const report: DocumentBackfillReport = {
    total: rows.length,
    processed: 0,
    pinnedFinals: 0,
    overwrittenDrafts: 0,
    skippedDrafts: 0,
    skippedNonGenre: 0,
    compileFailures: [],
    conflicts: [],
    unprocessed: 0,
    dryRun: opts.dryRun,
  };

  // Eligibility is decided without IO so `limit` means "exactly N compiled".
  const eligible: BackfillDocumentRow[] = [];
  for (const row of rows) {
    if (row.status === "draft" && !opts.includeDrafts) {
      report.skippedDrafts++;
      log(`skip draft ${row.id} (no --include-drafts)`);
      continue;
    }
    if (!(DOCUMENT_GENRES as readonly string[]).includes(row.type)) {
      report.skippedNonGenre++;
      log(`skip ${row.id}: unknown genre "${row.type}"`);
      continue;
    }
    eligible.push(row);
  }
  const batch =
    opts.limit !== undefined ? eligible.slice(0, opts.limit) : eligible;
  report.unprocessed = eligible.length - batch.length;
  if (report.unprocessed > 0) {
    log(
      `limit ${opts.limit} reached — ${report.unprocessed} eligible documents left unprocessed`,
    );
  }

  const processOne = async (row: BackfillDocumentRow): Promise<void> => {
    report.processed++;
    const digest = await store.readDigest(row);
    const compiled = compileDocument({
      genre: row.type as DocumentGenre,
      title: row.title,
      abstract: row.summary ?? "",
      markdownBody: digest,
    });
    // R6 holds for backfill too: compiled output must pass DocSpector (PLATE
    // excepted) before any write. Skip-and-report, never abort the run.
    const preflight = compiled.ok
      ? runDocumentPreflight({
          renderHtml: compiled.renderHtml,
          digestMarkdown: digest,
        })
      : null;
    if (!compiled.ok || (preflight && !preflight.ok)) {
      const codes = !compiled.ok
        ? compiled.diagnostics.map((d) => d.code)
        : (preflight && !preflight.ok
            ? preflight.diagnostics.map((d) => d.code)
            : []
          ).map((c) => `PREFLIGHT:${c}`);
      report.compileFailures.push({ artifactId: row.id, codes });
      log(`compile failed for ${row.id}: ${codes.join(",")}`);
      return;
    }

    if (opts.dryRun) {
      log(
        `[dry-run] would ${row.status === "final" ? "refresh head + pin new version" : "snapshot + overwrite draft head"} for ${row.id} (${row.type}, "${row.title}")`,
      );
      if (row.status === "final") report.pinnedFinals++;
      else report.overwrittenDrafts++;
      return;
    }

    if (row.status === "final") {
      // KTD6: head render first (what readers serve), then the guarded pin.
      await store.writeRenderHead(row, compiled.renderHtml);
      try {
        const pin = await store.pinHead(row, digest, compiled.renderHtml);
        report.pinnedFinals++;
        log(
          `pinned ${row.id} v${pin.headVersion}${pin.pinned ? "" : " (idempotent — content unchanged)"}`,
        );
      } catch (err) {
        if (!(err instanceof DocumentEmissionConflict)) throw err;
        // One reload-and-retry: a concurrent head write bumped the seq.
        const fresh = await store.reloadRow(row);
        if (!fresh) {
          report.conflicts.push(row.id);
          log(`conflict on ${row.id}: row vanished during backfill`);
          return;
        }
        try {
          const pin = await store.pinHead(fresh, digest, compiled.renderHtml);
          report.pinnedFinals++;
          log(`pinned ${row.id} v${pin.headVersion} after conflict retry`);
        } catch (retryErr) {
          if (!(retryErr instanceof DocumentEmissionConflict)) throw retryErr;
          report.conflicts.push(row.id);
          log(
            `conflict on ${row.id} persisted after retry — reported, not corrupted`,
          );
        }
      }
    } else {
      // Opted-in draft: snapshot the irrecoverable render BEFORE overwrite.
      await store.snapshotRender(row, opts.runId);
      await store.writeRenderHead(row, compiled.renderHtml);
      report.overwrittenDrafts++;
      log(`overwrote draft head ${row.id} (snapshot taken)`);
    }
  };

  // Simple worker pool; per-document work is independent (the pin CAS guards
  // cross-writer races), so pool workers never contend on the same row.
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, batch.length) },
    async () => {
      while (next < batch.length) {
        const row = batch[next++];
        await processOne(row);
      }
    },
  );
  await Promise.all(workers);

  return report;
}

/** Backup key for an opted-in draft's prior render (R11 doc-review fix). */
export function backfillBackupRenderKey(input: {
  tenantId: string;
  artifactId: string;
  runId: string;
}): string {
  return `tenants/${input.tenantId}/artifact-payloads/artifacts/${input.artifactId}/render/backfill-backup-${input.runId}.html`;
}
