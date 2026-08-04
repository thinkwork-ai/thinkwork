/**
 * agentcore-runtime-dispatch — thin waiting dispatcher (THINK-585 U6, KTD2).
 *
 * chat-agent-invoke keeps its exact setup and Event-mode fire-and-forget
 * shape but (flag-on) targets this Lambda instead of the Pi Lambda. Its only
 * job: unwrap the same LWA-style envelope, derive the per-thread session ID
 * server-side (KTD1 — never trusting a caller-supplied session ID), call
 * `InvokeAgentRuntimeCommand` against the SSM-resolved Pi runtime, and hold
 * the connection until the container finishes (the container's finalize
 * callback does all bookkeeping — a dispatcher crash mid-wait cannot
 * double-finalize).
 *
 * The payload delivered to the container is transport-identical to the
 * Lambda path: AgentCore POSTs this envelope's `body` to `/invocations`,
 * exactly what the Lambda Web Adapter would have done.
 *
 * Failure surface:
 * - 409 RetryableConflictException (another invocation holds the session):
 *   bounded backoff retries, then the turn fails cleanly.
 * - 424 RuntimeClientError (container crashed / bad response): turn marked
 *   failed with a pointer at the runtime log group. Never retried — the
 *   agent loop is not idempotent.
 * - Terraform wires EventInvokeConfig retries=0 + a DLQ; the redrive
 *   consumer (agentcore-dispatch-dlq-redrive) marks orphaned turns failed.
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { threadTurns } from "@thinkwork/database-pg/schema";
import { notifyThreadTurnUpdate } from "../lib/chat-finalize/notify.js";
import { releaseThreadCheckout } from "../lib/thread-checkout.js";
import { logAgentCorePhase } from "../lib/agentcore-phase-log.js";
import { deriveAgentCoreSessionId } from "../lib/agentcore-session-id.js";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";

export interface LwaInvocationEnvelope {
  requestContext?: { http?: { method?: string; path?: string } };
  rawPath?: string;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

/** Cached SSM runtime ID with TTL (same 5-min pattern the retired legacy Function URL invoker used). */
let cachedRuntimeId: string | null = null;
let cachedRuntimeIdAt = 0;
const RUNTIME_ID_CACHE_TTL_MS = 5 * 60 * 1000;

export function __resetRuntimeIdCacheForTests() {
  cachedRuntimeId = null;
  cachedRuntimeIdAt = 0;
}

async function resolvePiRuntimeArn(): Promise<string> {
  const ssmName = process.env.AGENTCORE_PI_RUNTIME_SSM_NAME;
  if (!ssmName) {
    throw new Error(
      "AGENTCORE_PI_RUNTIME_SSM_NAME is not configured; cannot resolve the Pi runtime.",
    );
  }
  if (
    !cachedRuntimeId ||
    Date.now() - cachedRuntimeIdAt >= RUNTIME_ID_CACHE_TTL_MS
  ) {
    const { SSMClient, GetParameterCommand } = await import(
      "@aws-sdk/client-ssm"
    );
    const ssm = new SSMClient({ region: AWS_REGION });
    const response = await ssm.send(new GetParameterCommand({ Name: ssmName }));
    const value = response.Parameter?.Value;
    if (!value || value === "None") {
      throw new Error(`SSM parameter ${ssmName} has no runtime ID.`);
    }
    cachedRuntimeId = value;
    cachedRuntimeIdAt = Date.now();
  }
  const accountId = process.env.AWS_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("AWS_ACCOUNT_ID is not configured.");
  }
  return `arn:aws:bedrock-agentcore:${AWS_REGION}:${accountId}:runtime/${cachedRuntimeId}`;
}

/** 409 backoff schedule — bounded (KTD2: never an unbounded retry).
 * Env-overridable (comma list, ms) so tests use real timers with tiny
 * delays instead of fake-timer scheduling, which proved CI-flaky. */
const CONFLICT_RETRY_DELAYS_MS = (
  process.env.DISPATCH_CONFLICT_RETRY_DELAYS_MS ?? "2000,4000,8000,16000"
)
  .split(",")
  .map((value) => Number(value));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function markTurnDispatchFailed(input: {
  turnId: string;
  tenantId: string;
  threadId: string;
  agentId: string;
  message: string;
}) {
  const db = getDb();
  try {
    await db
      .update(threadTurns)
      .set({
        status: "failed",
        finished_at: new Date(),
        last_activity_at: new Date(),
        error: input.message,
        error_code: "agentcore_runtime_dispatch_failed",
      })
      .where(
        and(
          eq(threadTurns.id, input.turnId),
          eq(threadTurns.tenant_id, input.tenantId),
          eq(threadTurns.status, "running"),
          sql`${threadTurns.finalized_at} IS NULL`,
        ),
      );
    await notifyThreadTurnUpdate({
      runId: input.turnId,
      tenantId: input.tenantId,
      threadId: input.threadId,
      agentId: input.agentId,
      status: "failed",
      triggerName: "AgentCore",
    });
  } catch (err) {
    console.error(
      "[agentcore-runtime-dispatch] Failed to mark dispatch failure on thread_turn:",
      err,
    );
  }
  // A dispatch-failed turn never reaches finalize, so release its thread
  // checkout here (no-op when this turn doesn't hold it).
  await releaseThreadCheckout({
    threadId: input.threadId,
    runId: input.turnId,
  }).catch(() => undefined);
}

interface EnvelopeIdentity {
  tenantId: string;
  agentId: string;
  userId: string;
  threadId: string;
  threadTurnId: string;
}

function extractIdentity(envelope: LwaInvocationEnvelope): EnvelopeIdentity {
  if (envelope.rawPath !== "/invocations" || !envelope.body) {
    throw new Error(
      "agentcore-runtime-dispatch expects the LWA /invocations envelope with a JSON body.",
    );
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(envelope.body) as Record<string, unknown>;
  } catch {
    throw new Error("Envelope body is not valid JSON.");
  }
  const tenantId = String(payload.tenant_id ?? "");
  const agentId = String(payload.assistant_id ?? "");
  const userId = String(payload.user_id ?? "");
  const threadId = String(payload.thread_id ?? "");
  const threadTurnId = String(payload.thread_turn_id ?? "");
  if (!tenantId || !agentId || !threadId || !threadTurnId) {
    throw new Error(
      "Envelope body is missing required identity fields (tenant_id, assistant_id, thread_id, thread_turn_id).",
    );
  }
  if (!userId) {
    // KTD1 keys the session on the human invoker. Wakeup/scheduled turns
    // (no user) stay on the Lambda path by design — reaching here without
    // a user is a routing bug, not a degraded mode.
    throw new Error(
      "Envelope body has no user_id; runtime dispatch requires the human invoker (wakeup turns stay on the Lambda path).",
    );
  }
  return { tenantId, agentId, userId, threadId, threadTurnId };
}

function isRetryableConflict(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? "";
  return name === "RetryableConflictException" || name === "ConflictException";
}

function isRuntimeClientError(err: unknown): boolean {
  return (
    ((err as { name?: string } | null)?.name ?? "") === "RuntimeClientError"
  );
}

export async function handler(event: LwaInvocationEnvelope): Promise<void> {
  const dispatchStart = Date.now();
  let identity: EnvelopeIdentity;
  try {
    identity = extractIdentity(event);
  } catch (err) {
    // Without identity there is no turn to fail — log loudly and let the
    // DLQ redrive consumer catch anything enveloped correctly.
    console.error(
      "[agentcore-runtime-dispatch] Rejected invalid envelope:",
      err instanceof Error ? err.message : err,
    );
    throw err;
  }

  const sessionId = deriveAgentCoreSessionId({
    tenantId: identity.tenantId,
    agentId: identity.agentId,
    userId: identity.userId,
    threadId: identity.threadId,
  });

  try {
    const runtimeArn = await resolvePiRuntimeArn();
    const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = await import(
      "@aws-sdk/client-bedrock-agentcore"
    );
    const client = new BedrockAgentCoreClient({
      region: AWS_REGION,
      requestHandler: {
        // Held connection: the container's turn budget (~870 s) always beats
        // this, which always beats the 900 s Lambda timeout.
        requestTimeout: 885_000,
      },
    });

    logAgentCorePhase({
      source: "agentcore-runtime-dispatch",
      phase: "api.runtime_dispatch.invoke",
      status: "started",
      threadTurnId: identity.threadTurnId,
      threadId: identity.threadId,
    });

    let lastConflict: unknown = null;
    for (
      let attempt = 0;
      attempt <= CONFLICT_RETRY_DELAYS_MS.length;
      attempt += 1
    ) {
      try {
        const response = await client.send(
          new InvokeAgentRuntimeCommand({
            agentRuntimeArn: runtimeArn,
            runtimeSessionId: sessionId,
            contentType: "application/json",
            payload: new TextEncoder().encode(event.body ?? ""),
          }),
        );
        // Drain the held response so the container's HTTP exchange fully
        // completes; the finalize callback owns all bookkeeping.
        if (typeof response.response?.transformToByteArray === "function") {
          await response.response.transformToByteArray();
        }
        logAgentCorePhase({
          source: "agentcore-runtime-dispatch",
          phase: "api.runtime_dispatch.invoke",
          status: "completed",
          durationMs: Date.now() - dispatchStart,
          threadTurnId: identity.threadTurnId,
          threadId: identity.threadId,
        });
        return;
      } catch (err) {
        if (
          isRetryableConflict(err) &&
          attempt < CONFLICT_RETRY_DELAYS_MS.length
        ) {
          lastConflict = err;
          const delay = CONFLICT_RETRY_DELAYS_MS[attempt];
          console.warn(
            `[agentcore-runtime-dispatch] 409 conflict on session ${sessionId.slice(0, 16)}… — retrying in ${delay}ms (attempt ${attempt + 1}/${CONFLICT_RETRY_DELAYS_MS.length})`,
          );
          await sleep(delay);
          continue;
        }
        if (isRetryableConflict(err)) {
          throw new Error(
            `Runtime session stayed busy after ${CONFLICT_RETRY_DELAYS_MS.length} retries (409): ${(lastConflict as Error | null)?.message ?? (err as Error).message}`,
          );
        }
        throw err;
      }
    }
  } catch (err) {
    const message = isRuntimeClientError(err)
      ? `Agent runtime container error (424). Check the runtime log group (/aws/bedrock-agentcore/runtimes/…-DEFAULT) for this session. ${(err as Error).message}`
      : err instanceof Error
        ? err.message
        : String(err);
    console.error(
      `[agentcore-runtime-dispatch] Dispatch failed for turn ${identity.threadTurnId}: ${message}`,
    );
    logAgentCorePhase({
      source: "agentcore-runtime-dispatch",
      phase: "api.runtime_dispatch.invoke",
      status: "failed",
      durationMs: Date.now() - dispatchStart,
      threadTurnId: identity.threadTurnId,
      threadId: identity.threadId,
    });
    await markTurnDispatchFailed({
      turnId: identity.threadTurnId,
      tenantId: identity.tenantId,
      threadId: identity.threadId,
      agentId: identity.agentId,
      message,
    });
  }
}
