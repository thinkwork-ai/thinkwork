/**
 * wiki-compile Lambda handler.
 *
 * Invoked by memory-retain (fire-and-forget after a turn) or by admin
 * mutations (compileWikiNow, lint promotion sweep). Runs one compile job per
 * invocation — either the job whose id is in the event payload, or the next
 * pending job if none is specified.
 *
 * This handler never throws. Errors flow back as `{ ok: false, error }` so
 * the retry queue can decide what to do without a CloudWatch alarm storm.
 */

import { S3Client } from "@aws-sdk/client-s3";

import { runCompileJob, runJobById } from "../lib/wiki/compiler.js";
import {
  runDraftCompileJob,
  runDraftCompileJobById,
} from "../lib/wiki/draft-compile.js";
import {
  claimNextCompileJob,
  getCompileJob,
  type WikiCompileJobRow,
} from "../lib/wiki/repository.js";
import {
  recordWikiBuildWorkflowEvidence,
  recordWikiBuildWorkflowStep,
  updateWikiBuildWorkflowRunSummary,
  type WikiBuildSystemWorkflowContext,
} from "../lib/system-workflows/wiki-build.js";
import { writeUserKnowledgePack } from "../lib/wiki/pack-renderer.js";
import {
  loadGooglePlacesClientFromSsm,
  type GooglePlacesClient,
} from "../lib/wiki/google-places-client.js";

const s3 = new S3Client({});

// Pre-warm the Google Places client on cold start so the "initialized" vs
// "key missing" log line lands immediately instead of at first compile.
// The call is idempotent and caches at module scope — warm invocations
// hit the cache without SSM or KMS traffic. A null return is fine: the
// compile pipeline degrades gracefully to metadata-only place rows.
let googlePlacesClientReady: Promise<GooglePlacesClient | null> | null = null;
function primeGooglePlacesClient(): Promise<GooglePlacesClient | null> {
  if (!googlePlacesClientReady) {
    googlePlacesClientReady = loadGooglePlacesClientFromSsm().catch((err) => {
      console.warn(
        `[wiki-compile] google places init error: ${(err as Error)?.message || err}`,
      );
      return null;
    });
  }
  return googlePlacesClientReady;
}

type WikiCompileEvent = {
  jobId?: string;
  /**
   * Optional Bedrock model override for this invocation. Threads through
   * to the planner, aggregation planner, and section writer so the whole
   * pipeline for this job lands on the same model. Leave unset to use the
   * Lambda's BEDROCK_MODEL_ID env (or the code default).
   */
  modelId?: string;
  /** Present when invoked by the wiki-build System Workflow parent. */
  systemWorkflowRunId?: string;
  systemWorkflowExecutionArn?: string;
  tenantId?: string;
  ownerId?: string;
  trigger?: string;
};

type WikiCompileResult = {
  ok: boolean;
  jobId?: string;
  status?: "succeeded" | "failed" | "no_job" | "already_done";
  metrics?: unknown;
  error?: string;
};

export async function handler(
  event: WikiCompileEvent = {},
): Promise<WikiCompileResult> {
  const workflowContext = wikiWorkflowContext(event);
  try {
    const googlePlacesClient = await primeGooglePlacesClient();
    const opts = {
      ...(event.modelId ? { modelId: event.modelId } : {}),
      googlePlacesClient,
    };
    if (event?.jobId) {
      const job = await getCompileJob(event.jobId);
      await recordClaimStep(workflowContext, {
        jobId: event.jobId,
        status: job ? "succeeded" : "skipped",
        outputJson: {
          jobId: event.jobId,
          trigger: job?.trigger ?? event.trigger ?? null,
          ownerId: job?.owner_id ?? event.ownerId ?? null,
          existingStatus: job?.status ?? null,
        },
      });
      if (!job || job.status === "succeeded" || job.status === "skipped") {
        const result = {
          ok: true,
          jobId: event.jobId,
          status: "already_done" as const,
        };
        await recordWikiWorkflowOutcome(workflowContext, {
          job,
          result,
          event,
        });
        return result;
      }
      if (job.trigger === "enrichment_draft") {
        const draft = await runDraftCompileJobById(event.jobId, {
          ...(event.modelId ? { modelId: event.modelId } : {}),
        });
        if (!draft) {
          const result = {
            ok: true,
            jobId: event.jobId,
            status: "already_done" as const,
          };
          await recordWikiWorkflowOutcome(workflowContext, {
            job,
            result,
            event,
          });
          return result;
        }
        const result = {
          ok: draft.status === "succeeded",
          jobId: draft.jobId,
          status: draft.status,
          ...(draft.error ? { error: draft.error } : {}),
        };
        await recordWikiWorkflowOutcome(workflowContext, {
          job,
          result,
          event,
        });
        return result;
      }
      const result = await runJobById(event.jobId, opts);
      if (!result) {
        const alreadyDone = {
          ok: true,
          jobId: event.jobId,
          status: "already_done" as const,
        };
        await recordWikiWorkflowOutcome(workflowContext, {
          job,
          result: alreadyDone,
          event,
        });
        return alreadyDone;
      }
      await writePackIfSucceeded(job, result.status);
      const response = {
        ok: result.status === "succeeded",
        jobId: result.jobId,
        status: result.status,
        metrics: result.metrics,
        error: result.error,
      };
      await recordWikiWorkflowOutcome(workflowContext, {
        job,
        result: response,
        event,
      });
      return response;
    }

    const claimed = await claimNextCompileJob();
    if (!claimed) {
      const result = { ok: true, status: "no_job" as const };
      await recordWikiWorkflowOutcome(workflowContext, {
        job: null,
        result,
        event,
      });
      return result;
    }
    await recordClaimStep(workflowContext, {
      jobId: claimed.id,
      status: "succeeded",
      outputJson: {
        jobId: claimed.id,
        trigger: claimed.trigger,
        ownerId: claimed.owner_id,
      },
    });
    if (claimed.trigger === "enrichment_draft") {
      const draft = await runDraftCompileJob(claimed, {
        ...(event.modelId ? { modelId: event.modelId } : {}),
      });
      const result = {
        ok: draft.status === "succeeded",
        jobId: draft.jobId,
        status: draft.status,
        ...(draft.error ? { error: draft.error } : {}),
      };
      await recordWikiWorkflowOutcome(workflowContext, {
        job: claimed,
        result,
        event,
      });
      return result;
    }
    const result = await runCompileJob(claimed, opts);
    await writePackIfSucceeded(claimed, result.status);
    const response = {
      ok: result.status === "succeeded",
      jobId: result.jobId,
      status: result.status,
      metrics: result.metrics,
      error: result.error,
    };
    await recordWikiWorkflowOutcome(workflowContext, {
      job: claimed,
      result: response,
      event,
    });
    return response;
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    console.error(`[wiki-compile] unexpected error: ${msg}`);
    await recordWikiWorkflowFailure(workflowContext, event, msg).catch(
      (recordErr) => {
        console.warn("[wiki-compile] workflow failure evidence write failed", {
          error: (recordErr as Error)?.message ?? String(recordErr),
        });
      },
    );
    return { ok: false, error: msg };
  }
}

function wikiWorkflowContext(
  event: WikiCompileEvent,
): WikiBuildSystemWorkflowContext | null {
  if (!event.systemWorkflowRunId || !event.tenantId) return null;
  return {
    tenantId: event.tenantId,
    runId: event.systemWorkflowRunId,
    executionArn: event.systemWorkflowExecutionArn ?? null,
  };
}

async function recordClaimStep(
  context: WikiBuildSystemWorkflowContext | null,
  input: {
    jobId: string;
    status: string;
    outputJson?: unknown;
    errorJson?: unknown;
  },
): Promise<void> {
  if (!context) return;
  await recordWikiBuildWorkflowStep(context, {
    nodeId: "ClaimCompileJob",
    stepType: "checkpoint",
    status: input.status,
    outputJson: input.outputJson,
    errorJson: input.errorJson,
    idempotencyKey: `wiki-build:${input.jobId}:claim`,
  });
}

async function recordWikiWorkflowOutcome(
  context: WikiBuildSystemWorkflowContext | null,
  input: {
    job: WikiCompileJobRow | null;
    result: WikiCompileResult;
    event: WikiCompileEvent;
  },
): Promise<void> {
  if (!context) return;

  const jobId =
    input.result.jobId ?? input.job?.id ?? input.event.jobId ?? "no-job";
  const ownerId = input.job?.owner_id ?? input.event.ownerId ?? null;
  const trigger = input.job?.trigger ?? input.event.trigger ?? null;
  const terminalStatus = input.result.ok ? "succeeded" : "failed";
  const summary = {
    workflow: "wiki-build",
    jobId,
    ownerId,
    trigger,
    status: input.result.status ?? (input.result.ok ? "succeeded" : "failed"),
    ok: input.result.ok,
    error: input.result.error ?? null,
    metrics: input.result.metrics ?? null,
  };

  await recordWikiBuildWorkflowStep(context, {
    nodeId: "CompilePages",
    stepType: "worker",
    status: terminalStatus,
    outputJson: summary,
    errorJson: input.result.ok
      ? undefined
      : { error: input.result.error ?? null },
    idempotencyKey: `wiki-build:${jobId}:compile`,
  });
  await recordWikiBuildWorkflowStep(context, {
    nodeId: "ValidateGraph",
    stepType: "validation",
    status: terminalStatus,
    outputJson: {
      gate: "compile_status",
      ok: input.result.ok,
      status: summary.status,
    },
    errorJson: input.result.ok
      ? undefined
      : { error: input.result.error ?? null },
    idempotencyKey: `wiki-build:${jobId}:quality-gate`,
  });
  await recordWikiBuildWorkflowEvidence(context, {
    evidenceType: "compile-summary",
    title: "Wiki compile summary",
    summary: `Wiki compile job ${jobId} ${summary.status}.`,
    artifactJson: summary,
    complianceTags: ["wiki", "knowledge"],
    idempotencyKey: `wiki-build:${jobId}:compile-summary`,
  });
  await recordWikiBuildWorkflowEvidence(context, {
    evidenceType: "quality-gates",
    title: "Wiki quality gate",
    summary: input.result.ok
      ? "Wiki compile status gate passed."
      : "Wiki compile status gate failed.",
    artifactJson: {
      gate: "compile_status",
      ok: input.result.ok,
      status: summary.status,
      error: input.result.error ?? null,
    },
    complianceTags: ["wiki", "quality"],
    idempotencyKey: `wiki-build:${jobId}:quality-gates`,
  });
  await updateWikiBuildWorkflowRunSummary(context, summary);
}

async function recordWikiWorkflowFailure(
  context: WikiBuildSystemWorkflowContext | null,
  event: WikiCompileEvent,
  error: string,
): Promise<void> {
  if (!context) return;
  const jobId = event.jobId ?? "unknown";
  await recordWikiBuildWorkflowStep(context, {
    nodeId: "CompilePages",
    stepType: "worker",
    status: "failed",
    errorJson: { error },
    idempotencyKey: `wiki-build:${jobId}:compile`,
  });
  await recordWikiBuildWorkflowEvidence(context, {
    evidenceType: "compile-summary",
    title: "Wiki compile failed",
    summary: `Wiki compile job ${jobId} failed before completion.`,
    artifactJson: { jobId, ok: false, error },
    complianceTags: ["wiki", "knowledge"],
    idempotencyKey: `wiki-build:${jobId}:compile-summary`,
  });
  await updateWikiBuildWorkflowRunSummary(context, {
    workflow: "wiki-build",
    jobId,
    ok: false,
    status: "failed",
    error,
  });
}

async function writePackIfSucceeded(
  job: WikiCompileJobRow,
  status: "succeeded" | "failed",
): Promise<void> {
  if (status !== "succeeded") return;
  try {
    await writeUserKnowledgePack({
      tenantId: job.tenant_id,
      userId: job.owner_id,
      s3Client: s3,
    });
  } catch (err) {
    console.warn("[wiki-pack] pack_s3_put_failed", {
      tenantId: job.tenant_id,
      userId: job.owner_id,
      error: (err as Error)?.message ?? String(err),
    });
  }
}
