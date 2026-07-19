import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";

type HarnessRetainPayload = Record<string, unknown>;

export interface HarnessMemoryRetainRequest {
  tenantId: string;
  userId: string;
  threadId: string;
  threadTurnId: string;
  spaceId?: string;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  metadata: {
    threadTurnId: string;
    sourceEventKey: string;
    spaceId?: string;
  };
}

export interface HarnessMemoryRetainDispatchResult {
  dispatched: boolean;
  reason?:
    | "memory_disabled"
    | "eval_traffic"
    | "missing_identity"
    | "invoke_failed";
  error?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isEvalTraffic(payload: HarnessRetainPayload): boolean {
  return (
    payload.eval_mode === true ||
    payload.eval_mode === "true" ||
    text(payload.trigger_channel).toLowerCase() === "eval"
  );
}

function transcriptFromPayload(
  payload: HarnessRetainPayload,
): HarnessMemoryRetainRequest["transcript"] {
  const transcript: HarnessMemoryRetainRequest["transcript"] = [];
  if (Array.isArray(payload.messages_history)) {
    for (const entry of payload.messages_history) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const role = text((entry as Record<string, unknown>).role).toLowerCase();
      const content = text((entry as Record<string, unknown>).content);
      if ((role === "user" || role === "assistant") && content) {
        transcript.push({ role, content });
      }
    }
  }
  const currentMessage = text(payload.message);
  if (currentMessage)
    transcript.push({ role: "user", content: currentMessage });
  return transcript;
}

/**
 * Build the same idempotent memory-retain envelope used by Pi after a normal
 * turn. The receiving Lambda re-reads the canonical transcript after Harness
 * finalization, so this bounded tail is recovery input rather than authority.
 */
export function buildHarnessMemoryRetainRequest(
  payload: HarnessRetainPayload,
): HarnessMemoryRetainRequest | null {
  if (payload.use_memory !== true && payload.use_memory !== "true") return null;
  if (isEvalTraffic(payload)) return null;

  const tenantId = text(payload.tenant_id);
  const userId = text(payload.user_id);
  const threadId = text(payload.thread_id);
  const threadTurnId = text(payload.thread_turn_id);
  if (!tenantId || !userId || !threadId || !threadTurnId) return null;

  const spaceId = text(payload.space_id);
  return {
    tenantId,
    userId,
    threadId,
    threadTurnId,
    ...(spaceId ? { spaceId } : {}),
    transcript: transcriptFromPayload(payload),
    metadata: {
      threadTurnId,
      sourceEventKey: `thread-turn:${threadTurnId}`,
      ...(spaceId ? { spaceId } : {}),
    },
  };
}

/**
 * Queue post-turn retention after the assistant message has been finalized.
 * Delivery is best-effort for the user response, while the memory-retain
 * attempt ledger provides durable retry and operator-visible evidence.
 */
export async function dispatchHarnessMemoryRetain(input: {
  payload: HarnessRetainPayload;
  functionName: string;
  lambdaClient: Pick<LambdaClient, "send">;
}): Promise<HarnessMemoryRetainDispatchResult> {
  if (
    input.payload.use_memory !== true &&
    input.payload.use_memory !== "true"
  ) {
    return { dispatched: false, reason: "memory_disabled" };
  }
  if (isEvalTraffic(input.payload)) {
    return { dispatched: false, reason: "eval_traffic" };
  }
  const request = buildHarnessMemoryRetainRequest(input.payload);
  if (!request) return { dispatched: false, reason: "missing_identity" };

  try {
    await input.lambdaClient.send(
      new InvokeCommand({
        FunctionName: input.functionName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(JSON.stringify(request)),
      }),
    );
    return { dispatched: true };
  } catch (error) {
    return {
      dispatched: false,
      reason: "invoke_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
