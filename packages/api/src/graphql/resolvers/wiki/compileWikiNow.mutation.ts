/**
 * compileWikiNow — admin-only: ad-hoc enqueue of a compile job for a
 * specific (tenant, user). Returns the job row so the admin UI can poll.
 *
 * Semantics match the post-turn enqueue path: dedupe on the 5-minute
 * bucket, fire-and-forget invoke of `wiki-compile` Lambda, never fail.
 *
 * Optional `modelId` is passed through to the Lambda event payload so a
 * single run can override `BEDROCK_MODEL_ID` without redeploying. The
 * override reaches the compile pipeline only via the Event-invoke payload;
 * if the invoke fails and a polling worker picks up the job later, it
 * falls back to the env default. Acceptable for v1 — follow-up can
 * persist `model_id` on `wiki_compile_jobs` if the gap bites.
 */

import type { GraphQLContext } from "../../context.js";
import { enqueueCompileJob } from "../../../lib/wiki/repository.js";
import { assertCanAdminWikiScope } from "./auth.js";

interface CompileWikiNowArgs {
  tenantId: string;
  userId?: string | null;
  ownerId?: string | null;
  modelId?: string | null;
}

export const compileWikiNow = async (
  _parent: unknown,
  args: CompileWikiNowArgs,
  ctx: GraphQLContext,
) => {
  const { tenantId, userId } = await assertCanAdminWikiScope(ctx, args);

  const { job } = await enqueueCompileJob({
    tenantId,
    ownerId: userId,
    trigger: "admin",
  });

  // Treat empty string as "not provided" — the compile pipeline's default
  // resolution (env var → code default) should kick in, not forward "".
  const modelId =
    typeof args.modelId === "string" && args.modelId.length > 0
      ? args.modelId
      : undefined;

  // Best-effort invoke of the compile Lambda. We don't await because the
  // dedupe job row gives us our idempotency guarantee; the Lambda handler
  // can also pick it up via claimNextCompileJob if this invoke fails.
  invokeWikiCompile(job.id, modelId).catch((invokeErr) => {
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

async function invokeWikiCompile(
  jobId: string,
  modelId?: string,
): Promise<void> {
  const fnName =
    process.env.WIKI_COMPILE_FN ??
    (process.env.STAGE
      ? `thinkwork-${process.env.STAGE}-api-wiki-compile`
      : null);
  if (!fnName) return;
  const { LambdaClient, InvokeCommand } = await import(
    "@aws-sdk/client-lambda"
  );
  const lambda = new LambdaClient({});
  const payload: { jobId: string; modelId?: string } = { jobId };
  if (modelId) payload.modelId = modelId;
  await lambda.send(
    new InvokeCommand({
      FunctionName: fnName,
      InvocationType: "Event",
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  );
}
