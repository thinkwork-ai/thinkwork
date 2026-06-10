/**
 * Graph wiki-compile enqueue (plan 2026-06-09-004 U10/U11). The natural
 * compile trigger is a successful observations ingest run — the
 * knowledge-graph mirror just changed. Called best-effort from the END of
 * the observations ingest worker's success path; never throws, never fails
 * the ingest run.
 *
 * The planner-era post-turn enqueue (`maybeEnqueuePostTurnCompile`, called
 * from memory-retain after each turn) was retired at the U11 cutover — the
 * consolidation → observations-ingest → graph-materialize chain replaces
 * per-turn compiles.
 */

import { eq } from "drizzle-orm";
import { tenants } from "@thinkwork/database-pg/schema";
import { db } from "../db.js";
import { enqueueGraphCompileJob } from "./repository.js";

export interface GraphCompileEnqueueResult {
  status:
    | "skipped_missing_inputs"
    | "skipped_tenant_not_found"
    | "skipped_flag_off"
    | "deduped"
    | "enqueued"
    | "enqueued_invoke_failed"
    | "error";
  jobId?: string;
  error?: string;
}

/**
 * Enqueue a tenant-keyed graph compile job (owner_id NULL). Honors the
 * tenant-level `wiki_compile_enabled` kill switch.
 */
export async function maybeEnqueueGraphWikiCompile(args: {
  tenantId: string;
}): Promise<GraphCompileEnqueueResult> {
  if (!args.tenantId) {
    return { status: "skipped_missing_inputs" };
  }

  try {
    const [tenantRow] = await db
      .select({ enabled: tenants.wiki_compile_enabled })
      .from(tenants)
      .where(eq(tenants.id, args.tenantId))
      .limit(1);

    if (!tenantRow) return { status: "skipped_tenant_not_found" };
    if (!tenantRow.enabled) return { status: "skipped_flag_off" };

    const { inserted, job } = await enqueueGraphCompileJob({
      tenantId: args.tenantId,
      trigger: "graph_materialize",
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
