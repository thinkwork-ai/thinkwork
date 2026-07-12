/**
 * Post-turn wiki-compile enqueue — called best-effort by memory-retain after a
 * successful retainTurn(). Never throws; never fails the caller.
 *
 * Semantics (see .prds/compounding-memory-v1-build-plan.md PR 2):
 * - Skip silently when the tenant's `wiki_compile_enabled` flag is off.
 * - Skip silently when the active memory adapter isn't Hindsight (AgentCore
 *   can't drive a cursor in v1).
 * - Insert a compile job with a 5-minute dedupe key `${tenant}:${owner}:${bucket}`.
 *   ON CONFLICT DO NOTHING — if a job is already running or queued for this
 *   bucket, skip the async invoke.
 * - On insert, async-invoke the `wiki-compile` Lambda (InvocationType=Event).
 *   If the invoke fails, the job row still exists and can be picked up by any
 *   compile worker (lint sweep, scheduled backfill, admin trigger).
 */

import { eq } from "drizzle-orm";
import { tenants } from "@thinkwork/database-pg/schema";
import { db } from "../db.js";
import {
  enqueueCompileJob,
  enqueueGraphCompileJob,
  type DbClient,
} from "./repository.js";

export interface PostTurnCompileArgs {
  tenantId: string;
  ownerId: string;
  adapterKind: string;
}

export interface PostTurnCompileResult {
  status:
    | "skipped_flag_off"
    | "skipped_adapter"
    | "skipped_missing_inputs"
    | "skipped_tenant_not_found"
    | "deduped"
    | "enqueued"
    | "enqueued_invoke_failed"
    | "error";
  jobId?: string;
  error?: string;
}

/**
 * Best-effort: resolve enqueue conditions, insert job, attempt async invoke.
 * All errors are captured and returned as a status so callers can log without
 * throwing.
 */
export async function maybeEnqueuePostTurnCompile(
  args: PostTurnCompileArgs,
): Promise<PostTurnCompileResult> {
  if (!args.tenantId || !args.ownerId) {
    return { status: "skipped_missing_inputs" };
  }
  if (args.adapterKind !== "hindsight") {
    return { status: "skipped_adapter" };
  }

  try {
    const [tenantRow] = await db
      .select({ enabled: tenants.wiki_compile_enabled })
      .from(tenants)
      .where(eq(tenants.id, args.tenantId))
      .limit(1);

    if (!tenantRow) return { status: "skipped_tenant_not_found" };
    if (!tenantRow.enabled) return { status: "skipped_flag_off" };

    const { inserted, job } = await enqueueCompileJob({
      tenantId: args.tenantId,
      ownerId: args.ownerId,
      trigger: "memory_retain",
    });

    if (!inserted) {
      return { status: "deduped", jobId: job.id };
    }

    const invokeErr = await invokeWikiCompile(job.id).catch((err) => err);
    if (invokeErr instanceof Error) {
      return {
        status: "enqueued_invoke_failed",
        jobId: job.id,
        error: invokeErr.message,
      };
    }

    return { status: "enqueued", jobId: job.id };
  } catch (err) {
    return { status: "error", error: (err as Error)?.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Transactional (outbox) enqueue — THINK-193 U4 dead-handoff fix.
//
// The observations ingest worker calls this INSIDE mergeKnowledgeGraphSnapshot's
// extraWork transaction: the compile-job row commits atomically with the
// mirror replace + run completion (an ingest can never report succeeded with
// no compile job on the ledger). The async invoke happens POST-COMMIT in the
// worker via `invokeWikiCompile`; if that invoke fails the job row survives
// for the scheduled wiki-compile drainer.
//
// Kill switches (documented choice): the stage-global WIKI_SOURCE flag gates
// graph-mode compile exactly as wiki-compile's own dispatch does, and the
// existing per-tenant `tenants.wiki_compile_enabled` flag is the per-tenant
// kill switch — no new mechanism. Flipping one tenant off stops its compile
// jobs without touching the stage.
// ---------------------------------------------------------------------------

export interface GraphCompileTxEnqueueResult {
  status:
    | "skipped_source_not_graph"
    | "skipped_tenant_not_found"
    | "skipped_flag_off"
    | "deduped"
    | "enqueued";
  jobId?: string;
  /** True only when THIS call inserted the job row (caller should invoke). */
  inserted: boolean;
}

/**
 * Enqueue the tenant-keyed graph compile job on the caller's transaction.
 * Throws on database errors — inside the ingest tx that correctly fails the
 * whole run rather than silently succeeding without a compile handoff.
 */
export async function enqueueGraphWikiCompileTx(
  tx: DbClient,
  args: {
    tenantId: string;
    /** Dirty canonical-entity scope for the compile (jsonb input). */
    dirtyCanonicalEntityIds?: string[];
  },
): Promise<GraphCompileTxEnqueueResult> {
  if (process.env.WIKI_SOURCE !== "graph") {
    return { status: "skipped_source_not_graph", inserted: false };
  }
  const [tenantRow] = await tx
    .select({ enabled: tenants.wiki_compile_enabled })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .limit(1);
  if (!tenantRow) {
    return { status: "skipped_tenant_not_found", inserted: false };
  }
  if (!tenantRow.enabled) {
    return { status: "skipped_flag_off", inserted: false };
  }

  const { inserted, job } = await enqueueGraphCompileJob(
    {
      tenantId: args.tenantId,
      trigger: "graph_materialize",
      dirtyCanonicalEntityIds: args.dirtyCanonicalEntityIds,
    },
    tx,
  );
  return {
    status: inserted ? "enqueued" : "deduped",
    jobId: job.id,
    inserted,
  };
}

// ---------------------------------------------------------------------------
// Async Lambda invoke (fire-and-forget). The function name follows the repo
// convention `thinkwork-${stage}-api-${handler}`; env var override wins if set
// (useful for tests and when the caller already knows the ARN).
// ---------------------------------------------------------------------------

export async function invokeWikiCompile(jobId: string): Promise<void> {
  const fnName = resolveWikiCompileFunctionName();
  if (!fnName) {
    console.warn(
      "[wiki-enqueue] wiki-compile function name unresolved (no STAGE or WIKI_COMPILE_FN); skipping invoke",
    );
    return;
  }

  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  await lambda.send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(JSON.stringify({ jobId })),
    }),
  );
}

function resolveWikiCompileFunctionName(): string | null {
  if (process.env.WIKI_COMPILE_FN) return process.env.WIKI_COMPILE_FN;
  const stage = process.env.STAGE;
  if (!stage) return null;
  return `thinkwork-${stage}-api-wiki-compile`;
}
