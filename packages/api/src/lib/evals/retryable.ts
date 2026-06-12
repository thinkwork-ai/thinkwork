/**
 * Shared retryability classification for eval execution infrastructure
 * errors. Lives outside eval-worker.ts so the scoring engines (which
 * the worker imports) can consult it without an import cycle.
 *
 * Throttling shapes (Lambda + Bedrock) are the only retryable
 * infrastructure errors: they redrive through SQS within the queue's
 * maxReceiveCount budget. Genuine timeouts are NOT retryable — the case
 * already consumed the full response budget, so it records error/timeout
 * immediately instead of burning redrives.
 */
import { AgentCoreEvalInvocationTimeoutError } from "./agentcore-direct.js";

export function isRetryableEvalInfrastructureError(error: unknown): boolean {
  if (error instanceof AgentCoreEvalInvocationTimeoutError) return false;
  const err = error as
    | { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
    | null
    | undefined;
  if (err?.$metadata?.httpStatusCode === 429) return true;
  if (
    typeof err?.name === "string" &&
    /^(ThrottlingException|TooManyRequestsException|ServiceQuotaExceededException)$/.test(
      err.name,
    )
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /ThrottlingException|TooManyRequestsException|ServiceQuotaExceededException|Lambda throttled|Rate exceeded|status(?:Code)?:?\s*429|\(429\)/i.test(
    message,
  );
}
