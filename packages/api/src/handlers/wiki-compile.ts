/**
 * wiki-compile Lambda handler.
 *
 * Invoked by the observations-ingest worker (fire-and-forget after a
 * successful mirror refresh) or by admin mutations (compileWikiNow). Runs
 * one compile job per invocation — either the job whose id is in the event
 * payload, or the next pending job if none is specified.
 *
 * Graph-only since the U11 cutover (plan 2026-06-09-004): the planner
 * extraction path (LLM leaf planner, section writer, aggregation pass,
 * Google Places enrichment, per-user knowledge packs) was deleted; every
 * compile is the deterministic graph→wiki materializer over the
 * knowledge-graph mirror. Tenant-keyed jobs only — residual owner-scoped
 * job rows (planner / lint promotion / enrichment drafts) are skipped by
 * the materializer's claim guard. No continuation chaining: each graph run
 * is a full pass, so there is never a remaining cursor to chain.
 *
 * This handler never throws. Errors flow back as `{ ok: false, error }` so
 * the retry queue can decide what to do without a CloudWatch alarm storm.
 */

import {
  runGraphCompileJobById,
  runNextGraphCompileJob,
} from "../lib/wiki/graph-materializer.js";
import { getCompileJob } from "../lib/wiki/repository.js";

type WikiCompileEvent = {
  jobId?: string;
  /**
   * Legacy planner-era Bedrock model override. Accepted (old payloads may
   * still be in flight) but ignored — the graph materializer is
   * deterministic / LLM-free.
   */
  modelId?: string;
};

type WikiCompileResult = {
  ok: boolean;
  jobId?: string;
  status?: "succeeded" | "failed" | "skipped" | "no_job" | "already_done";
  metrics?: unknown;
  error?: string;
};

export async function handler(
  event: WikiCompileEvent = {},
): Promise<WikiCompileResult> {
  try {
    if (event?.jobId) {
      const job = await getCompileJob(event.jobId);
      if (!job || job.status === "succeeded" || job.status === "skipped") {
        return {
          ok: true,
          jobId: event.jobId,
          status: "already_done" as const,
        };
      }
      const result = await runGraphCompileJobById(event.jobId);
      if (!result) {
        // CAS claim lost (concurrent invocation) or job no longer claimable.
        return {
          ok: true,
          jobId: event.jobId,
          status: "already_done" as const,
        };
      }
      return {
        ok: result.status !== "failed",
        jobId: result.jobId,
        status: result.status,
        metrics: result.metrics,
        ...(result.error ? { error: result.error } : {}),
      };
    }

    const result = await runNextGraphCompileJob();
    if (!result) {
      return { ok: true, status: "no_job" as const };
    }
    return {
      ok: result.status !== "failed",
      jobId: result.jobId,
      status: result.status,
      metrics: result.metrics,
      ...(result.error ? { error: result.error } : {}),
    };
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    console.error(`[wiki-compile] unexpected error: ${msg}`);
    return { ok: false, error: msg };
  }
}
