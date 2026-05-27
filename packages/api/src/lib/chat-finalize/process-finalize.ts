/**
 * processFinalize — the post-AgentCore code path lifted from
 * chat-agent-invoke.ts (plan 2026-05-22-006 U1).
 *
 * Today's chat-agent-invoke Lambda calls AgentCore RequestResponse-style
 * and runs every line of this function after the response returns. Once
 * the chat-agent-finalize Lambda ships (U3), the same logic runs from a
 * Strands-runtime HTTP callback instead.
 *
 * The function takes a {@link FinalizePayload} (mirrors the
 * AgentCore-response shape chat-agent-invoke used to read directly) and
 * does the full chain in order:
 *
 *   1. Resolve assistant response text + guardrail-block detection
 *   2. Insert guardrail-block row (if blocked + guardrail configured)
 *   3. Record Bedrock cost events + budget check + cost notification
 *   4. Record Hindsight phase costs
 *   5. Record tool costs (Nova Act, browser, etc.)
 *   6. Update the thread_turn (status, finished_at, usage_json,
 *      result_json) + notify subscribers
 *   7. Insert the assistant message + link orphan artifacts + bump
 *      thread timestamps + notify AppSync + push notification
 *   8. Mark the turn finalized_at = now() as the last step (idempotency
 *      gate for retried callbacks)
 *
 * Error semantics: best-effort throughout. Individual steps catch + log
 * their own errors so a guardrail-record failure doesn't block message
 * insertion, etc. The behavior must match chat-agent-invoke today.
 */

import { and, eq, gte, isNull } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { artifacts, threadTurns, threads } from "@thinkwork/database-pg/schema";
import {
  checkBudgetAndPause,
  extractUsage,
  notifyCostRecorded,
  recordCostEvents,
} from "../cost-recording.js";
import { notifyThreadUpdate } from "../../graphql/notify.js";
import { sendTurnCompletedPush } from "../push-notifications.js";
import { sendThreadReplyEmail } from "../email/thread-reply.js";
import { refreshCustomerOnboardingGoalFolderSafely } from "../spaces/customer-onboarding-goal-md.js";
import { recordGuardrailBlock } from "./record-guardrail-block.js";
import {
  GENERIC_AGENT_ERROR_MESSAGE,
  extractResponseText,
  insertAssistantMessage,
  markComputerTaskFailedFromFinalize,
  notifyNewMessage,
  notifyThreadTurnUpdate,
} from "./notify.js";
import type { FinalizePayload, FinalizeResponse } from "./types.js";

const db = getDb();

export interface ProcessFinalizeResult {
  /** True when the turn was finalized just now (false on idempotent re-entry). */
  finalized: boolean;
  /** The assistant message id when a new message was inserted; null otherwise. */
  messageId: string | null;
}

export function capturedSystemPromptFromFinalizePayload(
  payload: Pick<FinalizePayload, "composed_system_prompt" | "response">,
): string | null {
  const response = payload.response as
    | (Record<string, unknown> & { composed_system_prompt?: unknown })
    | undefined;
  const candidates = [
    payload.composed_system_prompt,
    response?.composed_system_prompt,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

/**
 * Runs the post-AgentCore finalize chain. Idempotent on
 * `thread_turns.finalized_at` — a second call for the same turn returns
 * `{ finalized: false, messageId: null }` without re-running side-effects.
 */
export async function processFinalize(
  payload: FinalizePayload,
): Promise<ProcessFinalizeResult> {
  const {
    thread_turn_id: turnId,
    tenant_id: tenantId,
    agent_id: agentId,
    thread_id: threadId,
    trace_id: traceId,
    user_message: userMessage = "",
    agent_model: agentModel = null,
    runtime_type: payloadRuntimeType = null,
    agent_slug: agentSlug = null,
    agent_name: agentName = null,
    duration_ms: durationMs,
    status,
    error_message: errorMessage,
    computer_id: computerId,
    computer_task_id: computerTaskId,
    guardrail_id: guardrailId,
  } = payload;

  // ---- Idempotency gate (the load-bearing dedup check) -----------------
  // A retried finalize call for the same turn must no-op. We check
  // finalized_at AND atomically set it inside the same UPDATE so two
  // concurrent calls can't both pass the gate.
  const claimed = await db
    .update(threadTurns)
    .set({ finalized_at: new Date() })
    .where(and(eq(threadTurns.id, turnId), isNull(threadTurns.finalized_at)))
    .returning({ id: threadTurns.id, runtimeType: threadTurns.runtime_type });
  if (claimed.length === 0) {
    console.log(
      `[chat-finalize] Idempotent — turn ${turnId} already finalized; skipping`,
    );
    return { finalized: false, messageId: null };
  }

  // ---- Failed-turn fast path ------------------------------------------
  if (status === "failed") {
    await handleFailedTurn({
      turnId,
      tenantId,
      threadId,
      agentId,
      computerId,
      computerTaskId,
      errorMessage,
      systemPrompt: capturedSystemPromptFromFinalizePayload(payload),
    });
    return { finalized: true, messageId: null };
  }

  // ---- Completed-turn finalize chain ----------------------------------
  const invokeResult = payload.response ?? {};
  const capturedSystemPrompt = capturedSystemPromptFromFinalizePayload(payload);
  const responseRuntimeType =
    typeof invokeResult.runtime === "string" ? invokeResult.runtime : null;
  const runtimeType =
    payloadRuntimeType ||
    responseRuntimeType ||
    claimed[0]?.runtimeType ||
    null;

  // 1. Response text + guardrail-block detection
  const responseData = invokeResult as Record<string, unknown>;
  let responseText = extractResponseText(responseData);

  const guardrailBlock =
    payload.guardrail_block ?? invokeResult.guardrail_block;

  if (guardrailBlock?.blocked) {
    console.log(
      `[chat-finalize] Guardrail block detected: type=${guardrailBlock.type} action=${guardrailBlock.action}`,
    );
    responseText = "This request was blocked by a content policy.";
    await recordGuardrailBlock({
      tenantId,
      agentId,
      guardrailId,
      threadId,
      block: guardrailBlock,
      userMessage,
    });
  }

  console.log(
    `[chat-finalize] Extracted response (${responseText.length} chars): ${responseText.slice(0, 100)}`,
  );

  // 2. Record Bedrock cost events
  const usage = payload.usage
    ? {
        model: payload.usage.model ?? agentModel ?? null,
        inputTokens: payload.usage.input_tokens ?? 0,
        outputTokens: payload.usage.output_tokens ?? 0,
        cachedReadTokens: payload.usage.cached_read_tokens ?? 0,
      }
    : extractUsage({ usage: undefined });
  const bedrockRequestIds = invokeResult.bedrock_request_ids;

  try {
    const costResult = await recordCostEvents({
      tenantId,
      agentId,
      requestId: turnId,
      model: usage.model || agentModel || null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedReadTokens: usage.cachedReadTokens,
      durationMs,
      inputText: userMessage,
      outputText: responseText,
      threadId,
      traceId,
      bedrockRequestIds,
      runtimeType,
    });
    await checkBudgetAndPause(tenantId, agentId);

    if (costResult.totalUsd > 0) {
      await notifyCostRecorded({
        tenantId,
        agentId,
        agentName: agentName ?? "",
        eventType: "invocation",
        amountUsd: costResult.totalUsd,
        model: usage.model || agentModel || null,
      });
    }
  } catch (costErr) {
    console.error(`[chat-finalize] Cost recording failed:`, costErr);
  }

  // 3. Record Hindsight phase costs
  const hindsightUsage = invokeResult.hindsight_usage ?? [];
  if (hindsightUsage.length > 0) {
    try {
      const { recordHindsightCost } = await import("../hindsight-cost.js");
      for (const entry of hindsightUsage) {
        await recordHindsightCost({
          tenantId,
          agentId,
          bankId: agentSlug ?? "",
          phase: entry.phase,
          model: entry.model,
          inputTokens: entry.input_tokens,
          outputTokens: entry.output_tokens,
          threadId,
          traceId,
          source: "agent_invoke",
        });
      }
      console.log(
        `[chat-finalize] Recorded ${hindsightUsage.length} Hindsight cost event(s)`,
      );
    } catch (hsCostErr) {
      console.error(
        `[chat-finalize] Hindsight cost recording failed:`,
        hsCostErr,
      );
    }
  }

  // 4. Record tool costs (Nova Act, browser sessions, etc.)
  const toolCosts = invokeResult.tool_costs ?? [];
  if (toolCosts.length > 0) {
    try {
      const { costEvents } = await import("@thinkwork/database-pg/schema");
      for (const tc of toolCosts) {
        await db
          .insert(costEvents)
          .values({
            tenant_id: tenantId,
            agent_id: agentId,
            thread_id: threadId || undefined,
            request_id: crypto.randomUUID(),
            event_type: String(tc.event_type || "tool_cost"),
            runtime_type: runtimeType || undefined,
            amount_usd: String(tc.amount_usd || "0.000000"),
            provider: String(tc.provider || "unknown"),
            duration_ms: (tc.duration_ms as number) || null,
            trace_id: traceId || undefined,
            metadata: {
              ...((tc.metadata as Record<string, unknown> | undefined) ?? {}),
              ...(runtimeType ? { runtime_type: runtimeType } : {}),
            },
          })
          .onConflictDoNothing();
      }
      console.log(`[chat-finalize] Recorded ${toolCosts.length} tool cost(s)`);
    } catch (err) {
      console.error(`[chat-finalize] Tool cost recording failed:`, err);
    }
  }

  // 5. Update thread_turn as succeeded
  const turnUsage = {
    duration_ms: durationMs,
    runtime_type: runtimeType,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cached_read_tokens: usage.cachedReadTokens,
    tools_called: invokeResult.tools_called ?? [],
    tool_costs: toolCosts.map((tc) => ({
      event_type: tc.event_type,
      amount_usd: tc.amount_usd,
      provider: tc.provider,
    })),
    tool_invocations: invokeResult.tool_invocations ?? [],
  };

  try {
    await db
      .update(threadTurns)
      .set({
        status: "succeeded",
        finished_at: new Date(),
        runtime_type: runtimeType || undefined,
        system_prompt: capturedSystemPrompt || undefined,
        result_json: {
          response: responseText.slice(0, 10000),
          runtime: runtimeType || undefined,
        },
        usage_json: turnUsage,
      })
      .where(eq(threadTurns.id, turnId));

    await notifyThreadTurnUpdate({
      runId: turnId,
      tenantId,
      threadId,
      agentId,
      status: "succeeded",
      triggerName: "Chat",
    });
  } catch (turnErr) {
    console.error(`[chat-finalize] Failed to update thread_turn:`, turnErr);
  }

  // Early exit on empty response (legacy behavior — no message inserted)
  if (!responseText || responseText === "{}") {
    console.warn(`[chat-finalize] Empty response from AgentCore`);
    return { finalized: true, messageId: null };
  }

  // 6. Compute downstream signals
  const displayResponse = responseText;
  const toolInvocations = invokeResult.tool_invocations ?? [];
  const computerThreadResponse = invokeResult.computer_thread_response;

  // 7. Insert assistant message (or reuse the one the runtime already
  //    created when invoked via the Computer thread surface)
  const assistantMsg = computerThreadResponse?.responseMessageId
    ? { id: computerThreadResponse.responseMessageId }
    : await insertAssistantMessage(
        threadId,
        tenantId,
        agentId,
        displayResponse,
        toolInvocations,
      );

  // 7a. Link orphan artifacts created during this turn to the thread + message.
  if (assistantMsg && !computerThreadResponse?.responseMessageId) {
    try {
      const turnStart = new Date(Date.now() - (durationMs + 5000)); // turn duration + buffer
      await db
        .update(artifacts)
        .set({
          thread_id: threadId,
          source_message_id: assistantMsg.id,
        })
        .where(
          and(
            eq(artifacts.agent_id, agentId),
            eq(artifacts.tenant_id, tenantId),
            isNull(artifacts.source_message_id),
            gte(artifacts.created_at, turnStart),
          ),
        );
    } catch (err) {
      console.error(`[chat-finalize] Failed to link orphan artifacts:`, err);
    }
  }

  // 7b. Bump thread timestamps — last_turn_completed_at drives inbox sorting
  if (!computerThreadResponse?.responseMessageId) {
    try {
      await db
        .update(threads)
        .set({
          updated_at: new Date(),
          last_turn_completed_at: new Date(),
          last_response_preview:
            displayResponse
              .replace(/[#*_`]/g, "")
              .trim()
              .slice(0, 200) || null,
        })
        .where(eq(threads.id, threadId));
    } catch (err) {
      console.error(`[chat-finalize] Failed to update thread updated_at:`, err);
    }
  }

  // 7c. Notify subscribers via AppSync
  if (assistantMsg && !computerThreadResponse?.responseMessageId) {
    await notifyNewMessage({
      messageId: assistantMsg.id,
      threadId,
      tenantId,
      role: "assistant",
      content: responseText,
      senderType: "agent",
      senderId: agentId,
    });
  }

  // 7d. Notify thread update so the home screen list re-sorts
  if (!computerThreadResponse?.responseMessageId) {
    try {
      notifyThreadUpdate({
        threadId,
        tenantId,
        status: "in_progress",
        title: "",
      }).catch(() => {});
    } catch {}
  }

  // 7e. Send push notification to user devices
  if (!computerThreadResponse?.responseMessageId) {
    try {
      await sendTurnCompletedPush({
        threadId,
        tenantId,
        agentId,
        title: agentName || "Agent",
        body: responseText.replace(/[#*_`]/g, "").trim(),
      });
    } catch (err) {
      console.error("[chat-finalize] Push notification failed:", err);
    }
  }

  // 7f. Email the response back to the original sender for threads that
  //     started from inbound email. No-op for chat-originated threads
  //     and for turns where the latest user message came from chat.
  if (assistantMsg && !computerThreadResponse?.responseMessageId) {
    try {
      await sendThreadReplyEmail({
        tenantId,
        threadId,
        agentId,
        body: responseText,
      });
    } catch (err) {
      console.error("[chat-finalize] Email reply dispatch failed:", err);
    }
  }

  if (assistantMsg) {
    await refreshCustomerOnboardingGoalFolderSafely({
      tenantId,
      threadId,
    });
  }

  return { finalized: true, messageId: assistantMsg?.id ?? null };
}

interface HandleFailedTurnInput {
  turnId: string;
  tenantId: string;
  threadId: string;
  agentId: string;
  computerId?: string | null;
  computerTaskId?: string | null;
  errorMessage?: string;
  systemPrompt?: string | null;
}

async function handleFailedTurn(input: HandleFailedTurnInput): Promise<void> {
  const { turnId, tenantId, threadId, agentId, computerId, computerTaskId } =
    input;
  const errMessage = input.errorMessage || GENERIC_AGENT_ERROR_MESSAGE;

  await markComputerTaskFailedFromFinalize({
    tenantId,
    computerId,
    taskId: computerTaskId,
    threadId,
    message: errMessage,
    code: "agent_runtime_failed",
  });

  try {
    await db
      .update(threadTurns)
      .set({
        status: "failed",
        finished_at: new Date(),
        error: errMessage,
        system_prompt: input.systemPrompt || undefined,
      })
      .where(eq(threadTurns.id, turnId));

    await notifyThreadTurnUpdate({
      runId: turnId,
      tenantId,
      threadId,
      agentId,
      status: "failed",
      triggerName: "Chat",
    });
  } catch (turnErr) {
    console.error(
      `[chat-finalize] Failed to update thread_turn on error:`,
      turnErr,
    );
  }

  try {
    const errMsg = await insertAssistantMessage(
      threadId,
      tenantId,
      agentId,
      GENERIC_AGENT_ERROR_MESSAGE,
    );
    if (errMsg) {
      await notifyNewMessage({
        messageId: errMsg.id,
        threadId,
        tenantId,
        role: "assistant",
        content: GENERIC_AGENT_ERROR_MESSAGE,
        senderType: "agent",
        senderId: agentId,
      });
    }
  } catch (innerErr) {
    console.error(`[chat-finalize] Failed to insert error message:`, innerErr);
  }
}

/** Convert processFinalize result to the FinalizeResponse HTTP body shape. */
export function toFinalizeResponse(
  result: ProcessFinalizeResult,
): FinalizeResponse {
  if (!result.finalized) return { ok: true, idempotent: true };
  return { ok: true, idempotent: false, messageId: result.messageId };
}
