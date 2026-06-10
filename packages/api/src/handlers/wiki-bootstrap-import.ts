/**
 * wiki-bootstrap-import Lambda.
 *
 * Async worker for `bootstrapJournalImport`. The GraphQL mutation fires this
 * Lambda with InvocationType='Event' and returns immediately — we can't hold
 * the 30-second API Gateway connection for a 2,800-record Hindsight ingest.
 *
 * Progress shows up in CloudWatch logs; final outcome is the compile job the
 * import enqueues on completion (admin polls wiki_compile_jobs for that).
 *
 * Graph contract (plan 2026-06-09-004 U14/U11): the "retain → terminal
 * compile produces pages" contract no longer holds — the enqueued
 * owner-scoped compile is skipped by the graph dispatcher, and pages
 * materialize only after the imported memories flow through
 * consolidation → observations ingest → graph materialization. The result
 * carries an explicit `note` so the operator isn't left polling for pages
 * that the import alone will never produce.
 */

import { runJournalImport } from "../lib/wiki/journal-import.js";

type WikiBootstrapEvent = {
  accountId?: string;
  tenantId?: string;
  userId?: string;
  limit?: number | null;
};

type WikiBootstrapResult = {
  ok: boolean;
  recordsIngested?: number;
  recordsSkipped?: number;
  errors?: number;
  compileJobId?: string | null;
  /** Operator-facing contract note (graph wiki pipeline). */
  note?: string;
  error?: string;
};

const GRAPH_MODE_NOTE =
  "Graph wiki: the terminal compile will NOT produce wiki pages " +
  "from this import. Pages materialize after the imported memories pass " +
  "through consolidation and the next observations ingest cycle " +
  "(consolidation → ingest → graph materialization).";

export async function handler(
  event: WikiBootstrapEvent = {},
): Promise<WikiBootstrapResult> {
  if (!event.accountId || !event.tenantId || !event.userId) {
    const msg = "wiki-bootstrap-import: missing accountId/tenantId/userId";
    console.error(`[wiki-bootstrap-import] ${msg}`);
    return { ok: false, error: msg };
  }

  const started = Date.now();
  console.log(
    `[wiki-bootstrap-import] starting account=${event.accountId} tenant=${event.tenantId} user=${event.userId} limit=${event.limit ?? "none"}`,
  );

  try {
    const result = await runJournalImport({
      accountId: event.accountId,
      tenantId: event.tenantId,
      userId: event.userId,
      limit: event.limit ?? undefined,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[wiki-bootstrap-import] done in ${seconds}s ingested=${result.recordsIngested} skipped=${result.recordsSkipped} errors=${result.errors} compileJobId=${result.compileJobId ?? "null"}`,
    );
    console.log(`[wiki-bootstrap-import] ${GRAPH_MODE_NOTE}`);
    return {
      ok: result.errors === 0,
      recordsIngested: result.recordsIngested,
      recordsSkipped: result.recordsSkipped,
      errors: result.errors,
      compileJobId: result.compileJobId,
      note: GRAPH_MODE_NOTE,
    };
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    console.error(`[wiki-bootstrap-import] failed: ${msg}`);
    return { ok: false, error: msg };
  }
}
