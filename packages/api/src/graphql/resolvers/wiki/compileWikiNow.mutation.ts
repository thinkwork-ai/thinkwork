/**
 * compileWikiNow — admin-only: ad-hoc enqueue of a tenant-level compile job
 * for the graph→wiki materializer. Returns the job row so the admin UI can
 * poll. Dedupe on the 5-minute bucket, fire-and-forget invoke of the
 * `wiki-compile` Lambda, never fail on the invoke.
 *
 * Tenant-routed unconditionally since the U11 cutover (plan 2026-06-09-004):
 * the planner's per-user compile path is gone, so the per-user owner key is
 * ignored and ONE tenant-keyed job (owner_id NULL, four-part `graph:obs:`
 * dedupe key) is enqueued. The null `ownerId` in the response is the
 * client-visible signal that the server compiled tenant-level — the CLI
 * uses it to stop per-agent fan-out. `tenantScope` and `modelId` args are
 * accepted for contract compatibility but no longer change behavior (the
 * materializer is deterministic / LLM-free).
 */

import type { GraphQLContext } from "../../context.js";
import { enqueueGraphCompileJob } from "../../../lib/wiki/repository.js";
import { hasServiceSecret } from "../core/authz.js";
import { WikiAuthError } from "./auth.js";

interface CompileWikiNowArgs {
  tenantId: string;
  userId?: string | null;
  ownerId?: string | null;
  modelId?: string | null;
  forceNew?: boolean | null;
  tenantScope?: boolean | null;
}

export const compileWikiNow = async (
  _parent: unknown,
  args: CompileWikiNowArgs,
  ctx: GraphQLContext,
) => {
  if (!hasServiceSecret(ctx)) {
    throw new WikiAuthError("Admin-only: requires internal API key credential");
  }
  if (ctx.auth.tenantId && ctx.auth.tenantId !== args.tenantId) {
    throw new WikiAuthError("Access denied: tenant mismatch");
  }

  const { job } = await enqueueGraphCompileJob({
    tenantId: args.tenantId,
    trigger: "admin",
    dedupeDiscriminator:
      args.forceNew === true ? `rebuild-${Date.now()}` : undefined,
  });

  // Best-effort invoke of the compile Lambda. We don't await because the
  // dedupe job row gives us our idempotency guarantee; the Lambda handler
  // can also pick it up via claimNextCompileJob if this invoke fails.
  invokeWikiCompile(job.id).catch((invokeErr) => {
    console.warn(
      `[compileWikiNow] invoke failed (job will be picked up by worker): ${(invokeErr as Error)?.message}`,
    );
  });

  return {
    id: job.id,
    tenantId: job.tenant_id,
    userId: job.owner_id,
    ownerId: job.owner_id,
    status: job.status,
    trigger: job.trigger,
    dedupeKey: job.dedupe_key,
    attempt: job.attempt,
    claimedAt: job.claimed_at?.toISOString() ?? null,
    startedAt: job.started_at?.toISOString() ?? null,
    finishedAt: job.finished_at?.toISOString() ?? null,
    error: job.error,
    metrics: job.metrics,
    createdAt: job.created_at.toISOString(),
  };
};

async function invokeWikiCompile(jobId: string): Promise<void> {
  const fnName =
    process.env.WIKI_COMPILE_FN ??
    (process.env.STAGE
      ? `thinkwork-${process.env.STAGE}-api-wiki-compile`
      : null);
  if (!fnName) return;
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
