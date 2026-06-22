/**
 * processFinalize — the post-AgentCore code path lifted from
 * chat-agent-invoke.ts (plan 2026-05-22-006 U1).
 *
 * Today's chat-agent-invoke Lambda calls AgentCore RequestResponse-style
 * and runs every line of this function after the response returns. Once
 * the chat-agent-finalize Lambda ships (U3), the same logic runs from a
 * AgentCore runtime HTTP callback instead.
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

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  artifacts,
  messages,
  pendingUserQuestions,
  threadTurns,
  threads,
} from "@thinkwork/database-pg/schema";
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
import {
  appendThreadTurnEvent,
  drizzleThreadTurnEventStore,
} from "../thread-turn-events.js";
import { promoteNextDeferredWakeup } from "../wakeup-defer.js";
import {
  buildWorkspaceProjectionReconcileSummary,
  mergeWorkspaceProjectionReconcileSummary,
} from "../workspace-projection-snapshot.js";
import { finalizeN8nAgentStepRun } from "../n8n-agent-step/finalize.js";
import { autoSubmitSkillCreatorDraft } from "../skill-creator/auto-submit-draft.js";
import { recordGuardrailBlock } from "./record-guardrail-block.js";
import {
  GENERIC_AGENT_ERROR_MESSAGE,
  extractResponseText,
  insertAssistantMessage,
  markComputerTaskFailedFromFinalize,
  notifyNewMessage,
  notifyThreadTurnUpdate,
} from "./notify.js";
import { reconcileChangedFiles, type ReconcileReport } from "./reconcile.js";
import type {
  AgentLoopEvidence,
  FinalizeAgentProfileRun,
  FinalizeGoalRunProjection,
  FinalizePayload,
  FinalizeResponse,
} from "./types.js";

const db = getDb();

export interface ProcessFinalizeResult {
  /** True when the turn was finalized just now (false on idempotent re-entry). */
  finalized: boolean;
  /** The assistant message id when a new message was inserted; null otherwise. */
  messageId: string | null;
  /** Per-file workspace reconcile result for this finalize call. */
  reconcile?: ReconcileReport;
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

export function diagnosticsFromFinalizePayload(
  payload: Pick<FinalizePayload, "usage" | "response">,
): Record<string, unknown> | undefined {
  return payload.usage?.diagnostics ?? payload.response?.diagnostics;
}

/**
 * Runs the post-AgentCore finalize chain. Reconcile is claimed before
 * `thread_turns.finalized_at` becomes terminal, so non-empty diff failures can
 * be retried. A second call after finalized_at is set returns
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
    cost_owner_user_id: costOwnerUserId = null,
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
  // Reconcile runs before finalized_at is terminal. The claim records an
  // in-progress reconcile marker in context_snapshot so a non-empty diff can
  // fail, be marked failed, and be retried without finalized_at suppressing it.
  const claimConditions = [
    eq(threadTurns.id, turnId),
    isNull(threadTurns.finalized_at),
    sql`coalesce(${threadTurns.context_snapshot}->'workspace_reconcile'->>'status', 'idle') != 'running'`,
  ];
  if (payload.claim?.invocation_source) {
    claimConditions.push(
      eq(threadTurns.invocation_source, payload.claim.invocation_source),
    );
  }
  if (payload.claim?.status) {
    claimConditions.push(eq(threadTurns.status, payload.claim.status));
  }
  if (payload.claim?.context_owner) {
    claimConditions.push(
      sql`COALESCE(${threadTurns.context_snapshot} #>> '{mobile_turn,ownership}', 'mobile') = ${payload.claim.context_owner}`,
    );
  }
  const claimed = await db
    .update(threadTurns)
    .set({
      context_snapshot: sql`jsonb_set(coalesce(${threadTurns.context_snapshot}, '{}'::jsonb), '{workspace_reconcile,status}', '"running"'::jsonb, true)`,
    })
    .where(and(...claimConditions))
    .returning({
      id: threadTurns.id,
      runtimeType: threadTurns.runtime_type,
      contextSnapshot: threadTurns.context_snapshot,
    });
  if (claimed.length === 0) {
    console.log(
      `[chat-finalize] Idempotent — turn ${turnId} already finalized; skipping`,
    );
    return { finalized: false, messageId: null };
  }

  // ---- Failed-turn fast path ------------------------------------------
  const hiddenDesktopDelegation = isHiddenDesktopDelegation(
    claimed[0]?.contextSnapshot,
  );

  let reconcileReport: ReconcileReport;
  const reconcileStartedAt = Date.now();
  let reconcileDurationMs = 0;
  try {
    reconcileReport = await reconcileChangedFiles({
      tenantId,
      agentId,
      threadId,
      threadTurnId: turnId,
      changedFiles: payload.changed_files ?? [],
    });
    reconcileDurationMs = Math.max(0, Date.now() - reconcileStartedAt);
    await recordWorkspaceReconcileStatus(turnId, {
      status: "complete",
      report: reconcileReport,
    });
    // U6 (plan 2026-06-12-002): merge a compact reconcile summary into the
    // dispatch-time workspace projection — additive (only the `reconcile`
    // key) and never blocking: a merge failure must not fail finalize.
    try {
      await mergeWorkspaceProjectionReconcileSummary(
        turnId,
        buildWorkspaceProjectionReconcileSummary(reconcileReport),
      );
    } catch (mergeErr) {
      console.error(
        `[chat-finalize] workspace projection reconcile merge failed (finalize proceeds):`,
        mergeErr,
      );
    }
  } catch (err) {
    reconcileDurationMs = Math.max(0, Date.now() - reconcileStartedAt);
    await recordWorkspaceReconcileStatus(turnId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (status === "completed") {
    try {
      const skillCreatorRequesterUserId =
        costOwnerUserId ??
        (payload.skill_creator_command
          ? await resolveSkillCreatorRequesterUserId({ tenantId, threadId })
          : null);
      const skillDraftRegistration = await autoSubmitSkillCreatorDraft({
        tenantId,
        threadId,
        threadTurnId: turnId,
        requesterUserId: skillCreatorRequesterUserId,
        userMessage,
        skillCreatorCommand: payload.skill_creator_command,
        reconcileReport,
      });
      if (skillDraftRegistration.status !== "skipped") {
        console.log(
          `[chat-finalize] /skill-creator ${skillDraftRegistration.status} draft ${skillDraftRegistration.draftId} (${skillDraftRegistration.slug})`,
        );
      }
    } catch (err) {
      console.error(
        "[chat-finalize] /skill-creator draft registration failed (finalize proceeds):",
        err,
      );
    }
  }

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
      suppressAssistantMessage: hiddenDesktopDelegation,
    });
    await markTurnFinalized(turnId);
    await promoteDeferredWakeupSafely(tenantId, threadId);
    await finalizeN8nAgentStepRunSafely({
      tenantId,
      threadId,
      threadTurnId: turnId,
      resolution: "turn_failed",
      error: errorMessage ?? GENERIC_AGENT_ERROR_MESSAGE,
      summary: errorMessage ?? GENERIC_AGENT_ERROR_MESSAGE,
    });
    return { finalized: true, messageId: null, reconcile: reconcileReport };
  }

  // ---- Completed-turn finalize chain ----------------------------------
  const invokeResult = payload.response ?? {};
  const modelRoutedToolCalls = collectModelRoutedToolCalls(invokeResult);
  const agentProfileRuns = collectAgentProfileRuns(payload);
  const toolInvocations = enrichToolInvocationsWithModelRouting(
    invokeResult.tool_invocations ?? [],
  );
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
  let parentCostUsd: number | null = null;

  try {
    const costResult = await recordCostEvents({
      tenantId,
      agentId,
      userId: costOwnerUserId,
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
    parentCostUsd = costResult.totalUsd;
    await checkBudgetAndPause(tenantId, agentId, costOwnerUserId);

    if (costResult.totalUsd > 0) {
      await notifyCostRecorded({
        tenantId,
        agentId,
        agentName: agentName ?? "",
        userId: costOwnerUserId,
        eventType: "invocation",
        amountUsd: costResult.totalUsd,
        model: usage.model || agentModel || null,
      });
    }
  } catch (costErr) {
    console.error(`[chat-finalize] Cost recording failed:`, costErr);
  }

  await recordModelRoutedToolEvidence({
    tenantId,
    agentId,
    userId: costOwnerUserId,
    turnId,
    threadId,
    traceId,
    runtimeType,
    agentName,
    modelRoutedToolCalls,
  });
  await recordAgentProfileRunEvidence({
    tenantId,
    agentId,
    userId: costOwnerUserId,
    turnId,
    threadId,
    traceId,
    runtimeType,
    agentName,
    agentProfileRuns,
  });
  applyModelRoutedToolCosts(toolInvocations, modelRoutedToolCalls);
  applyParentModelFallbackToolEvidence(toolInvocations, {
    model: usage.model || agentModel || null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedReadTokens: usage.cachedReadTokens,
    costUsd: parentCostUsd,
  });

  // 3. Record Hindsight phase costs
  const hindsightUsage = invokeResult.hindsight_usage ?? [];
  if (hindsightUsage.length > 0) {
    try {
      const { recordHindsightCost } = await import("../hindsight-cost.js");
      for (const entry of hindsightUsage) {
        await recordHindsightCost({
          tenantId,
          agentId,
          userId: costOwnerUserId,
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
            user_id: costOwnerUserId || undefined,
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
  const diagnostics = diagnosticsWithWorkspaceReconcile(
    diagnosticsFromFinalizePayload(payload),
    reconcileReport,
    reconcileDurationMs,
  );
  const aggregateUsage = aggregateTurnUsage({
    parent: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedReadTokens: usage.cachedReadTokens,
      costUsd: parentCostUsd,
    },
    modelRoutedToolCalls,
    agentProfileRuns,
  });
  const parentUsage = {
    model: usage.model || agentModel || null,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cached_read_tokens: usage.cachedReadTokens,
    cost_usd: parentCostUsd,
  };
  const goalRun = goalRunProjectionFromFinalizePayload(payload);
  const turnUsage = {
    model: usage.model || agentModel || null,
    duration_ms: durationMs,
    runtime_type: runtimeType,
    input_tokens: aggregateUsage.inputTokens,
    output_tokens: aggregateUsage.outputTokens,
    cached_read_tokens: aggregateUsage.cachedReadTokens,
    cost_usd: aggregateUsage.costUsd,
    parent_usage: parentUsage,
    diagnostics,
    tools_called: invokeResult.tools_called ?? [],
    tool_costs: toolCosts.map((tc) => ({
      event_type: tc.event_type,
      amount_usd: tc.amount_usd,
      provider: tc.provider,
    })),
    tool_invocations: toolInvocations,
    model_routed_tool_calls: modelRoutedToolCalls,
    agent_profile_runs: agentProfileRuns,
    ...(goalRun ? { goal_run: goalRun } : {}),
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
          ...(goalRun ? { goal_run: goalRun } : {}),
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
    await markTurnFinalized(turnId);
    await promoteDeferredWakeupSafely(tenantId, threadId);
    await finalizeN8nAgentStepRunSafely({
      tenantId,
      threadId,
      threadTurnId: turnId,
      resolution: "turn_completed",
      summary: "ThinkWork agent step completed.",
      output: { response: "" },
    });
    return { finalized: true, messageId: null, reconcile: reconcileReport };
  }

  if (hiddenDesktopDelegation) {
    console.log(
      `[chat-finalize] Hidden desktop delegation ${turnId} finalized without inserting an assistant message`,
    );
    await markTurnFinalized(turnId);
    await promoteDeferredWakeupSafely(tenantId, threadId);
    await finalizeN8nAgentStepRunSafely({
      tenantId,
      threadId,
      threadTurnId: turnId,
      resolution: "turn_completed",
      summary: responseText,
      output: { response: responseText },
    });
    return { finalized: true, messageId: null, reconcile: reconcileReport };
  }

  // 6. Compute downstream signals
  const displayResponse = responseText;
  const computerThreadResponse = invokeResult.computer_thread_response;

  // ask_user_question asking-turn finalize (plan 2026-06-09-005 U3): when
  // this turn called the ask tool AND a pending question row actually
  // exists, the thread is waiting on the USER, not done — the list
  // preview shows the question (not the trailing prose) and the
  // turn-completed push is suppressed. The row probe is the gate (not
  // the tool name alone): tools_called records at execution START, so a
  // FAILED/409'd ask leaves no pending row and must finalize normally —
  // including the completion push. Trailing assistant text still
  // persists as a normal message below.
  const askedUserQuestion = turnAskedUserQuestion(invokeResult);
  let hasPendingQuestion = false;
  let askingQuestionPreview: string | null = null;
  if (askedUserQuestion) {
    const pendingState = await loadPendingQuestionState(threadId);
    hasPendingQuestion = pendingState.pending;
    askingQuestionPreview = pendingState.preview;
  }

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
        invokeResult.ui_message_parts,
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
            // Asking turn: preview the question the thread is waiting on,
            // not the trailing prose.
            askingQuestionPreview ??
            (displayResponse
              .replace(/[#*_`]/g, "")
              .trim()
              .slice(0, 200) ||
              null),
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

  // 7e. Send push notification to user devices — suppressed only when a
  // pending question row exists: the thread is waiting on the user, not
  // done. (Tool name alone is NOT enough — a failed ask must still push.)
  if (!computerThreadResponse?.responseMessageId && !hasPendingQuestion) {
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

  await markTurnFinalized(turnId);

  // Promote the next deferred wakeup for this thread, mirroring the
  // wakeup-processor's end-of-turn promotion. Without this, a deferred
  // question_answer wakeup (a card answered while this turn was running)
  // is stranded when the turn completes via the finalize path. Promotion
  // only flips status 'deferred'→'queued' — the wakeup-processor's
  // 1-minute poll picks the queued row up and runs it.
  await promoteDeferredWakeupSafely(tenantId, threadId);
  await finalizeN8nAgentStepRunSafely({
    tenantId,
    threadId,
    threadTurnId: turnId,
    resolution: "turn_completed",
    summary: responseText,
    output: { response: responseText },
  });

  return {
    finalized: true,
    messageId: assistantMsg?.id ?? null,
    reconcile: reconcileReport,
  };
}

export function goalRunProjectionFromFinalizePayload(
  payload: Pick<FinalizePayload, "response" | "usage">,
): FinalizeGoalRunProjection | null {
  const response = payload.response as Record<string, unknown> | undefined;
  const candidate = response?.goal_run ?? payload.usage?.goal_run;
  if (candidate == null) return null;
  return normalizeGoalRunProjection(candidate);
}

/**
 * Best-effort end-of-turn deferred-wakeup promotion (PRD-09 Batch 4
 * contract, same as the wakeup-processor's call sites). Never throws —
 * a promotion failure must not fail an otherwise-finalized turn.
 */
async function promoteDeferredWakeupSafely(
  tenantId: string,
  threadId: string,
): Promise<void> {
  if (!threadId) return;
  try {
    await promoteNextDeferredWakeup(tenantId, threadId);
  } catch {}
}

async function finalizeN8nAgentStepRunSafely(
  input: Parameters<typeof finalizeN8nAgentStepRun>[0],
): Promise<void> {
  try {
    await finalizeN8nAgentStepRun(input);
  } catch (err) {
    console.error("[chat-finalize] n8n bridge finalization failed:", err);
  }
}

/** Tool name the ask-user-question Pi extension registers (U5). */
const ASK_USER_QUESTION_TOOL = "ask_user_question";

/**
 * Detect whether the finalizing turn called ask_user_question (the "ask
 * sentinel" for finalize purposes, plan 2026-06-09-005 U3).
 *
 * Detection is deliberately belt-and-suspenders across the two places the
 * runtime reports tool activity — `tools_called` (flat string list) and
 * `tool_invocations` (rich records whose name key has varied across
 * runtime versions: toolName | tool_name | name). Matching by TOOL NAME
 * (not a payload marker) is robust to U5's sentinel-result shape evolving:
 * the tool only ever returns successfully after the intake persisted the
 * pending row, so name presence ⇒ a question was asked this turn. The
 * preview lookup below re-checks the pending row, so a 409'd or failed
 * ask call degrades to normal-finalize behavior, not a wrong preview.
 */
export function turnAskedUserQuestion(invokeResult: {
  tools_called?: string[];
  tool_invocations?: Array<Record<string, unknown>>;
}): boolean {
  if (
    Array.isArray(invokeResult.tools_called) &&
    invokeResult.tools_called.includes(ASK_USER_QUESTION_TOOL)
  ) {
    return true;
  }
  for (const invocation of invokeResult.tool_invocations ?? []) {
    if (!invocation || typeof invocation !== "object") continue;
    const name = invocation.toolName ?? invocation.tool_name ?? invocation.name;
    if (name === ASK_USER_QUESTION_TOOL) return true;
  }
  return false;
}

/**
 * Pending-question state for the thread's open batch: whether a pending
 * row EXISTS (gates push suppression — the tool name alone can't, since
 * tools_called records at execution start even for failed asks) and the
 * first question text for threads.last_response_preview. Best-effort:
 * `{ pending: false }` (→ normal finalize behavior) when no pending row
 * exists — e.g. the ask 409'd or failed, or the user already answered in
 * the finalize window — or when the probe itself fails.
 */
async function loadPendingQuestionState(
  threadId: string,
): Promise<{ pending: boolean; preview: string | null }> {
  try {
    const [row] = await db
      .select({ questions: pendingUserQuestions.questions })
      .from(pendingUserQuestions)
      .where(
        and(
          eq(pendingUserQuestions.thread_id, threadId),
          eq(pendingUserQuestions.status, "pending"),
        ),
      )
      .orderBy(desc(pendingUserQuestions.created_at))
      .limit(1);
    if (!row) return { pending: false, preview: null };
    const questions = row.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      return { pending: true, preview: null };
    }
    const first = questions[0] as Record<string, unknown> | null;
    const text =
      first && typeof first.question === "string"
        ? first.question
        : first && typeof first.header === "string"
          ? first.header
          : null;
    return {
      pending: true,
      preview: text ? text.trim().slice(0, 200) || null : null,
    };
  } catch (err) {
    console.error(
      "[chat-finalize] Failed to load pending question state:",
      err,
    );
    return { pending: false, preview: null };
  }
}

export function diagnosticsWithWorkspaceReconcile(
  diagnostics: Record<string, unknown> | undefined,
  reconcileReport: ReconcileReport,
  reconcileDurationMs: number,
): Record<string, unknown> {
  const base = diagnostics ?? {};
  const existingWorkspaceDiagnostics = readRecord(base.workspace_diagnostics);
  const rejectedFiles = reconcileReport.files.filter(
    (file) => file.status === "rejected",
  );
  const persistedFiles = reconcileReport.files.filter(
    (file) => file.status === "written" || file.status === "deleted",
  );
  const conflictedFiles = rejectedFiles.filter(
    (file) =>
      file.code === "base_etag_mismatch" || file.code === "precondition_failed",
  );

  return {
    ...base,
    workspace_diagnostics: {
      ...existingWorkspaceDiagnostics,
      reconcile_writeback_ms: reconcileDurationMs,
      reconcile_status: reconcileReport.status,
      changed_files: reconcileReport.files.length,
      persisted_files: persistedFiles.length,
      rejected_files: rejectedFiles.length,
      conflicted_files: conflictedFiles.length,
    },
  };
}

export interface ModelRoutedToolCallEvidence {
  toolCallId: string;
  toolName: string;
  match: Record<string, string>;
  model: string;
  ruleSource: Record<string, unknown>;
  status: "completed" | "rejected" | "failed";
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens?: number;
  totalTokens?: number;
  durationMs: number;
  costUsd?: number;
  error?: string;
}

export interface AgentProfileRunEvidence {
  profileRunId: string;
  profileId: string;
  profileSlug: string;
  profileName: string;
  model: string;
  status: FinalizeAgentProfileRun["status"];
  startedAt?: string;
  finishedAt?: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  parentThreadTurnId?: string;
  handoffSummary?: string;
  laneKey: string;
  loopEvidence?: AgentLoopEvidence;
  error?: string;
  toolInvocations: Array<Record<string, unknown>>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

const GOAL_RUN_TEXT_LIMIT = 600;
const GOAL_RUN_DEBUG_LIMIT = 1000;

const GOAL_RUN_STATUSES = new Set([
  "active",
  "paused",
  "budget_limited",
  "complete",
  "completed",
  "cancelled",
  "cleared",
]);

function normalizeGoalRunProjection(value: unknown): FinalizeGoalRunProjection {
  const record = readRecord(value);
  if (Object.keys(record).length === 0) {
    return malformedGoalRunProjection(value);
  }

  const rawStatus = stringValue(record.status)?.toLowerCase();
  const status = GOAL_RUN_STATUSES.has(rawStatus ?? "")
    ? (rawStatus as FinalizeGoalRunProjection["status"])
    : "unknown";
  const tokensUsed = optionalFiniteNumber(
    record.tokens_used ?? record.tokensUsed ?? record.total_tokens,
  );
  const tokenBudget = optionalFiniteNumber(
    record.token_budget ?? record.tokenBudget,
  );
  const completionSummary =
    boundedString(record.completion_summary ?? record.completionSummary) ??
    boundedString(readRecord(record.completion).summary);
  const completionNotes =
    boundedString(record.completion_notes ?? record.completionNotes) ??
    boundedString(readRecord(record.completion).notes);
  const verificationNotes = boundedStringArray(
    record.verification_notes ?? record.verificationNotes,
  );

  return {
    source: "pi_goal",
    status,
    ...(boundedString(record.action)
      ? { action: boundedString(record.action) }
      : {}),
    ...(boundedString(record.goal_id ?? record.goalId)
      ? { goal_id: boundedString(record.goal_id ?? record.goalId) }
      : {}),
    ...(boundedString(record.objective)
      ? { objective: boundedString(record.objective) }
      : {}),
    ...(boundedString(record.summary)
      ? { summary: boundedString(record.summary) }
      : {}),
    ...(completionSummary ? { completion_summary: completionSummary } : {}),
    ...(completionNotes ? { completion_notes: completionNotes } : {}),
    ...(verificationNotes.length > 0
      ? { verification_notes: verificationNotes }
      : {}),
    ...(tokenBudget !== undefined ? { token_budget: tokenBudget } : {}),
    ...(tokensUsed !== undefined ? { tokens_used: tokensUsed } : {}),
    ...(optionalFiniteNumber(record.iteration) !== undefined
      ? { iteration: optionalFiniteNumber(record.iteration) }
      : {}),
    ...(optionalFiniteNumber(
      record.time_used_seconds ?? record.timeUsedSeconds,
    ) !== undefined
      ? {
          time_used_seconds: optionalFiniteNumber(
            record.time_used_seconds ?? record.timeUsedSeconds,
          ),
        }
      : {}),
    ...(boundedString(
      record.budget_limited_reason ?? record.budgetLimitedReason,
    )
      ? {
          budget_limited_reason: boundedString(
            record.budget_limited_reason ?? record.budgetLimitedReason,
          ),
        }
      : {}),
    ...(boundedString(record.continuation_policy ?? record.continuationPolicy)
      ? {
          continuation_policy: boundedString(
            record.continuation_policy ?? record.continuationPolicy,
          ),
        }
      : {}),
    resume_eligible: status === "budget_limited" || status === "paused",
    ...(boundedIsoString(record.started_at ?? record.startedAt)
      ? { started_at: boundedIsoString(record.started_at ?? record.startedAt) }
      : {}),
    ...(boundedIsoString(record.updated_at ?? record.updatedAt)
      ? { updated_at: boundedIsoString(record.updated_at ?? record.updatedAt) }
      : {}),
  };
}

function malformedGoalRunProjection(value: unknown): FinalizeGoalRunProjection {
  return {
    source: "pi_goal",
    status: "unknown",
    summary: "Malformed goal-run evidence",
    resume_eligible: false,
    debug: {
      error: "malformed_goal_run",
      preview: boundedJsonPreview(value),
    },
  };
}

function optionalFiniteNumber(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function boundedString(value: unknown, limit = GOAL_RUN_TEXT_LIMIT) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function boundedIsoString(value: unknown) {
  const text = boundedString(value, 80);
  if (!text) return undefined;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? text : undefined;
}

function boundedStringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [];
  return values
    .flatMap((entry) => {
      const text = boundedString(entry, 240);
      return text ? [text] : [];
    })
    .slice(0, 5);
}

function boundedJsonPreview(value: unknown): string {
  try {
    return boundedString(JSON.stringify(value), GOAL_RUN_DEBUG_LIMIT) ?? "";
  } catch {
    return String(value).slice(0, GOAL_RUN_DEBUG_LIMIT);
  }
}

function stringRecord(value: unknown): Record<string, string> {
  const record = readRecord(value);
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      result[key] = String(raw);
    }
  }
  return result;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = readRecord(item);
        return Object.keys(record).length > 0 ? [record] : [];
      })
    : [];
}

function normalizeLoopEvidence(value: unknown): AgentLoopEvidence | undefined {
  const record = readRecord(value);
  if (Object.keys(record).length === 0) return undefined;

  const ownerType = stringValue(record.ownerType ?? record.owner_type);
  const loopId = stringValue(record.loopId ?? record.loop_id);
  const ownerSlug = stringValue(record.ownerSlug ?? record.owner_slug);
  const iterations = Array.isArray(record.iterations)
    ? record.iterations.map((iteration) => {
        const iterationRecord = readRecord(iteration);
        return {
          ...iterationRecord,
          ...(optionalNumberValue(iterationRecord.index) !== undefined
            ? { index: optionalNumberValue(iterationRecord.index) }
            : {}),
          ...(stringValue(iterationRecord.phase)
            ? { phase: stringValue(iterationRecord.phase) }
            : {}),
          ...(stringValue(iterationRecord.status)
            ? { status: stringValue(iterationRecord.status) }
            : {}),
          ...(stringValue(iterationRecord.verdict)
            ? { verdict: stringValue(iterationRecord.verdict) }
            : {}),
        };
      })
    : undefined;

  return {
    ...record,
    ...(loopId ? { loopId } : {}),
    ...(ownerType === "parent" || ownerType === "profile" ? { ownerType } : {}),
    ...(ownerSlug ? { ownerSlug } : {}),
    ...(Object.keys(readRecord(record.policy)).length > 0
      ? { policy: readRecord(record.policy) }
      : {}),
    ...(iterations ? { iterations } : {}),
  };
}

function loopMetadataFromEvidence(
  evidence: AgentLoopEvidence | undefined,
): Record<string, unknown> {
  if (!evidence) return {};
  const iterations = Array.isArray(evidence.iterations)
    ? evidence.iterations
    : [];
  const reviewerRole =
    evidence.ownerSlug === "reviewer" ||
    iterations.some((iteration) => iteration.phase === "final_review");
  const latestIteration = iterations.at(-1);
  return {
    loop_evidence: evidence,
    ...(evidence.loopId ? { loop_id: evidence.loopId } : {}),
    ...(evidence.ownerType ? { loop_owner_type: evidence.ownerType } : {}),
    ...(evidence.ownerSlug ? { loop_owner_slug: evidence.ownerSlug } : {}),
    ...(latestIteration?.index !== undefined
      ? { loop_iteration_index: latestIteration.index }
      : {}),
    ...(latestIteration?.phase ? { loop_phase: latestIteration.phase } : {}),
    ...(latestIteration?.status ? { loop_status: latestIteration.status } : {}),
    ...(latestIteration?.verdict
      ? { loop_verdict: latestIteration.verdict }
      : {}),
    ...(reviewerRole ? { reviewer_role: true } : {}),
  };
}

function normalizeAgentProfileRun(
  value: unknown,
): AgentProfileRunEvidence | null {
  const record = readRecord(value);
  const profileRunId =
    stringValue(record.profileRunId) ?? stringValue(record.profile_run_id);
  const profileId =
    stringValue(record.profileId) ?? stringValue(record.profile_id);
  const profileSlug =
    stringValue(record.profileSlug) ?? stringValue(record.profile_slug);
  const profileName =
    stringValue(record.profileName) ??
    stringValue(record.profile_name) ??
    profileSlug;
  const model = stringValue(record.model);
  if (!profileRunId || !profileId || !profileSlug || !profileName || !model) {
    return null;
  }

  const rawStatus = stringValue(record.status);
  const status: FinalizeAgentProfileRun["status"] =
    rawStatus === "failed" ||
    rawStatus === "timed_out" ||
    rawStatus === "interrupted" ||
    rawStatus === "resource_limit_exceeded"
      ? rawStatus
      : "completed";
  const laneKey =
    stringValue(record.laneKey) ??
    stringValue(record.lane_key) ??
    `profile:${profileSlug}`;
  const loopEvidence = normalizeLoopEvidence(
    record.loopEvidence ?? record.loop_evidence,
  );

  return {
    profileRunId,
    profileId,
    profileSlug,
    profileName,
    model,
    status,
    startedAt: stringValue(record.startedAt) ?? stringValue(record.started_at),
    finishedAt:
      stringValue(record.finishedAt) ?? stringValue(record.finished_at),
    durationMs: numberValue(record.durationMs ?? record.duration_ms),
    inputTokens: numberValue(record.inputTokens ?? record.input_tokens),
    outputTokens: numberValue(record.outputTokens ?? record.output_tokens),
    cachedReadTokens: numberValue(
      record.cachedReadTokens ?? record.cached_read_tokens,
    ),
    laneKey,
    toolInvocations: arrayOfRecords(
      record.toolInvocations ?? record.tool_invocations,
    ),
    ...(loopEvidence ? { loopEvidence } : {}),
    ...(optionalNumberValue(
      record.cachedWriteTokens ?? record.cached_write_tokens,
    ) !== undefined
      ? {
          cachedWriteTokens: optionalNumberValue(
            record.cachedWriteTokens ?? record.cached_write_tokens,
          ),
        }
      : {}),
    ...(optionalNumberValue(record.totalTokens ?? record.total_tokens) !==
    undefined
      ? {
          totalTokens: optionalNumberValue(
            record.totalTokens ?? record.total_tokens,
          ),
        }
      : {}),
    ...(optionalNumberValue(record.costUsd ?? record.cost_usd) !== undefined
      ? { costUsd: optionalNumberValue(record.costUsd ?? record.cost_usd) }
      : {}),
    ...(stringValue(record.parentThreadTurnId ?? record.parent_thread_turn_id)
      ? {
          parentThreadTurnId: stringValue(
            record.parentThreadTurnId ?? record.parent_thread_turn_id,
          ),
        }
      : {}),
    ...(stringValue(record.handoffSummary ?? record.handoff_summary)
      ? {
          handoffSummary: stringValue(
            record.handoffSummary ?? record.handoff_summary,
          ),
        }
      : {}),
    ...(stringValue(record.error) ? { error: stringValue(record.error) } : {}),
  };
}

export function collectAgentProfileRuns(
  payload: Pick<FinalizePayload, "agent_profile_runs" | "response">,
): AgentProfileRunEvidence[] {
  const byId = new Map<string, AgentProfileRunEvidence>();
  const add = (run: AgentProfileRunEvidence | null) => {
    if (!run) return;
    byId.set(run.profileRunId, run);
  };

  for (const item of payload.agent_profile_runs ?? []) {
    add(normalizeAgentProfileRun(item));
  }
  for (const item of payload.response?.agent_profile_runs ?? []) {
    add(normalizeAgentProfileRun(item));
  }
  for (const invocation of payload.response?.tool_invocations ?? []) {
    const record = readRecord(invocation);
    add(
      normalizeAgentProfileRun(
        record.agent_profile_run ??
          record.agentProfileRun ??
          readRecord(record.result).agent_profile_run ??
          readRecord(record.result).agentProfileRun,
      ),
    );
  }

  return [...byId.values()];
}

function normalizeModelRoutedToolCall(
  value: unknown,
  fallback?: { toolCallId?: string; toolName?: string },
): ModelRoutedToolCallEvidence | null {
  const record = readRecord(value);
  const model = stringValue(record.model);
  if (!model) return null;
  const statusValue = stringValue(record.status);
  const status =
    statusValue === "rejected" || statusValue === "failed"
      ? statusValue
      : "completed";
  const toolCallId =
    stringValue(record.toolCallId) ??
    stringValue(record.tool_call_id) ??
    fallback?.toolCallId;
  const toolName =
    stringValue(record.toolName) ??
    stringValue(record.tool_name) ??
    fallback?.toolName;
  if (!toolCallId || !toolName) return null;
  const ruleSource = readRecord(record.ruleSource ?? record.rule_source);
  return {
    toolCallId,
    toolName,
    match: stringRecord(record.match),
    model,
    ruleSource,
    status,
    inputTokens: numberValue(record.inputTokens ?? record.input_tokens),
    outputTokens: numberValue(record.outputTokens ?? record.output_tokens),
    cachedReadTokens: numberValue(
      record.cachedReadTokens ?? record.cached_read_tokens,
    ),
    durationMs: numberValue(record.durationMs ?? record.duration_ms),
    ...(optionalNumberValue(record.costUsd ?? record.cost_usd) !== undefined
      ? { costUsd: optionalNumberValue(record.costUsd ?? record.cost_usd) }
      : {}),
    ...(optionalNumberValue(
      record.cachedWriteTokens ?? record.cached_write_tokens,
    ) !== undefined
      ? {
          cachedWriteTokens: optionalNumberValue(
            record.cachedWriteTokens ?? record.cached_write_tokens,
          ),
        }
      : {}),
    ...(optionalNumberValue(record.totalTokens ?? record.total_tokens) !==
    undefined
      ? {
          totalTokens: optionalNumberValue(
            record.totalTokens ?? record.total_tokens,
          ),
        }
      : {}),
    ...(stringValue(record.error) ? { error: stringValue(record.error) } : {}),
  };
}

export function collectModelRoutedToolCalls(
  response: Pick<NonNullable<FinalizePayload["response"]>, "tool_invocations"> &
    Record<string, unknown>,
): ModelRoutedToolCallEvidence[] {
  const byKey = new Map<string, ModelRoutedToolCallEvidence>();
  const add = (call: ModelRoutedToolCallEvidence | null) => {
    if (!call) return;
    byKey.set(call.toolCallId, call);
  };

  const explicit = response.model_routed_tool_calls;
  if (Array.isArray(explicit)) {
    for (const item of explicit) add(normalizeModelRoutedToolCall(item));
  }

  for (const invocation of response.tool_invocations ?? []) {
    const record = readRecord(invocation);
    add(
      normalizeModelRoutedToolCall(
        record.model_routing ?? record.modelRouting,
        {
          toolCallId: stringValue(record.id),
          toolName:
            stringValue(record.tool_name) ??
            stringValue(record.toolName) ??
            stringValue(record.name),
        },
      ),
    );
  }

  return [...byKey.values()];
}

export function enrichToolInvocationsWithModelRouting(
  toolInvocations: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return toolInvocations.map((invocation) => {
    const routing = normalizeModelRoutedToolCall(
      invocation.model_routing ?? invocation.modelRouting,
      {
        toolCallId: stringValue(invocation.id),
        toolName:
          stringValue(invocation.tool_name) ??
          stringValue(invocation.toolName) ??
          stringValue(invocation.name),
      },
    );
    if (!routing) return invocation;
    return {
      ...invocation,
      model: routing.model,
      input_tokens: routing.inputTokens,
      output_tokens: routing.outputTokens,
      cached_read_tokens: routing.cachedReadTokens,
      cost_usd: routing.costUsd,
      model_routing_status: routing.status,
      model_routing_rule_source: routing.ruleSource,
      model_routing_match: routing.match,
      model_routing: invocation.model_routing ?? routing,
    };
  });
}

function applyModelRoutedToolCosts(
  toolInvocations: Array<Record<string, unknown>>,
  routedCalls: ModelRoutedToolCallEvidence[],
): void {
  const costByToolCallId = new Map(
    routedCalls
      .filter((call) => call.costUsd !== undefined)
      .map((call) => [call.toolCallId, call.costUsd!]),
  );
  if (costByToolCallId.size === 0) return;
  for (const invocation of toolInvocations) {
    const toolCallId = stringValue(invocation.id);
    if (!toolCallId) continue;
    const costUsd = costByToolCallId.get(toolCallId);
    if (costUsd === undefined) continue;
    invocation.cost_usd = costUsd;
    const routing = readRecord(invocation.model_routing);
    if (Object.keys(routing).length > 0) {
      invocation.model_routing = {
        ...routing,
        costUsd,
        cost_usd: costUsd,
      };
    }
  }
}

function splitIntegerTotal(total: number, count: number): number[] {
  if (count <= 0) return [];
  const normalizedTotal = Math.max(0, Math.trunc(total));
  const base = Math.floor(normalizedTotal / count);
  let remainder = normalizedTotal - base * count;
  return Array.from({ length: count }, () => {
    const value = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return value;
  });
}

function splitMoneyTotal(total: number | null, count: number): number[] {
  if (count <= 0 || total == null || !Number.isFinite(total) || total < 0) {
    return [];
  }
  const base = total / count;
  const values = Array.from({ length: count }, () => base);
  const assigned = values.slice(0, -1).reduce((sum, value) => sum + value, 0);
  values[count - 1] = total - assigned;
  return values;
}

function hasToolModelEvidence(invocation: Record<string, unknown>): boolean {
  if (
    stringValue(invocation.model ?? invocation.model_id ?? invocation.modelId)
  ) {
    return true;
  }
  return normalizeModelRoutedToolCall(
    invocation.model_routing ?? invocation.modelRouting,
    {
      toolCallId: stringValue(invocation.id),
      toolName:
        stringValue(invocation.tool_name) ??
        stringValue(invocation.toolName) ??
        stringValue(invocation.name),
    },
  )
    ? true
    : false;
}

function applyParentModelFallbackToolEvidence(
  toolInvocations: Array<Record<string, unknown>>,
  parent: {
    model?: string | null;
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    costUsd: number | null;
  },
): void {
  const model = parent.model?.trim();
  if (!model) return;

  const fallbackInvocations = toolInvocations.filter(
    (invocation) => !hasToolModelEvidence(invocation),
  );
  if (fallbackInvocations.length === 0) return;

  const inputSplits = splitIntegerTotal(
    parent.inputTokens,
    fallbackInvocations.length,
  );
  const outputSplits = splitIntegerTotal(
    parent.outputTokens,
    fallbackInvocations.length,
  );
  const cachedReadSplits = splitIntegerTotal(
    parent.cachedReadTokens,
    fallbackInvocations.length,
  );
  const costSplits = splitMoneyTotal(
    parent.costUsd,
    fallbackInvocations.length,
  );

  fallbackInvocations.forEach((invocation, index) => {
    const toolName =
      stringValue(invocation.tool_name) ??
      stringValue(invocation.toolName) ??
      stringValue(invocation.name) ??
      "tool";
    invocation.model = model;
    invocation.input_tokens = inputSplits[index] ?? 0;
    invocation.output_tokens = outputSplits[index] ?? 0;
    invocation.cached_read_tokens = cachedReadSplits[index] ?? 0;
    if (costSplits[index] !== undefined) {
      invocation.cost_usd = costSplits[index];
    }
    invocation.model_routing_status = "parent_model";
    invocation.model_routing_rule_source = {
      owner: "composer",
      path: "composer model selection",
    };
    invocation.model_routing_match = {
      tool: toolName,
      fallback: "composer_model",
    };
  });
}

async function recordModelRoutedToolEvidence(input: {
  tenantId: string;
  agentId: string;
  userId?: string | null;
  turnId: string;
  threadId: string;
  traceId?: string;
  runtimeType?: string | null;
  agentName?: string | null;
  modelRoutedToolCalls: ModelRoutedToolCallEvidence[];
}): Promise<void> {
  if (input.modelRoutedToolCalls.length === 0) return;

  let childSpendRecorded = false;
  for (const call of input.modelRoutedToolCalls) {
    const metadata = {
      parent_request_id: input.turnId,
      tool_call_id: call.toolCallId,
      tool_name: call.toolName,
      rule_source: call.ruleSource,
      match: call.match,
      model_routing_status: call.status,
      ...(call.error ? { error: call.error } : {}),
    };

    try {
      await appendThreadTurnEvent(drizzleThreadTurnEventStore(db), {
        tenantId: input.tenantId,
        runId: input.turnId,
        agentId: input.agentId,
        eventType: "model_routed_tool_call",
        stream: "step",
        level: call.status === "completed" ? "info" : "error",
        color: call.status === "completed" ? "green" : "red",
        message:
          call.status === "completed"
            ? `Tool ${call.toolName} used routed model ${call.model}`
            : `Tool ${call.toolName} model route ${call.status}`,
        payload: {
          tool_call_id: call.toolCallId,
          tool_name: call.toolName,
          model: call.model,
          input_tokens: call.inputTokens,
          output_tokens: call.outputTokens,
          cached_read_tokens: call.cachedReadTokens,
          duration_ms: call.durationMs,
          cost_usd: call.costUsd,
          status: call.status,
          rule_source: call.ruleSource,
          match: call.match,
          ...(call.error ? { error: call.error } : {}),
        },
      });
    } catch (eventErr) {
      console.error(
        `[chat-finalize] Model-routed tool event recording failed:`,
        eventErr,
      );
    }

    if (call.status !== "completed") continue;

    try {
      const costResult = await recordCostEvents({
        tenantId: input.tenantId,
        agentId: input.agentId,
        userId: input.userId,
        requestId: `${input.turnId}:tool:${call.toolCallId}:model`,
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        cachedReadTokens: call.cachedReadTokens,
        durationMs: call.durationMs,
        threadId: input.threadId,
        traceId: input.traceId,
        runtimeType: input.runtimeType,
        source: "pi_tool_model_route",
        metadata,
        recordCompute: false,
      });
      if (costResult.totalUsd > 0) {
        call.costUsd = costResult.llmUsd;
        childSpendRecorded = true;
        await notifyCostRecorded({
          tenantId: input.tenantId,
          agentId: input.agentId,
          agentName: input.agentName ?? "",
          userId: input.userId,
          eventType: "tool_model_route",
          amountUsd: costResult.totalUsd,
          model: call.model,
        });
      }
    } catch (costErr) {
      console.error(
        `[chat-finalize] Model-routed tool cost recording failed:`,
        costErr,
      );
    }
  }

  if (childSpendRecorded) {
    try {
      await checkBudgetAndPause(input.tenantId, input.agentId, input.userId);
    } catch (budgetErr) {
      console.error(
        `[chat-finalize] Model-routed tool budget check failed:`,
        budgetErr,
      );
    }
  }
}

async function recordAgentProfileRunEvidence(input: {
  tenantId: string;
  agentId: string;
  userId?: string | null;
  turnId: string;
  threadId: string;
  traceId?: string;
  runtimeType?: string | null;
  agentName?: string | null;
  agentProfileRuns: AgentProfileRunEvidence[];
}): Promise<void> {
  if (input.agentProfileRuns.length === 0) return;

  let childSpendRecorded = false;
  for (const run of input.agentProfileRuns) {
    const metadata = {
      parent_request_id: input.turnId,
      profile_run_id: run.profileRunId,
      profile_id: run.profileId,
      profile_slug: run.profileSlug,
      profile_name: run.profileName,
      lane_key: run.laneKey,
      profile_status: run.status,
      ...loopMetadataFromEvidence(run.loopEvidence),
      ...(run.error ? { error: run.error } : {}),
    };

    if (run.status === "completed") {
      try {
        const costResult = await recordCostEvents({
          tenantId: input.tenantId,
          agentId: input.agentId,
          userId: input.userId,
          requestId: `${input.turnId}:profile:${run.profileRunId}:model`,
          model: run.model,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cachedReadTokens: run.cachedReadTokens,
          durationMs: run.durationMs,
          threadId: input.threadId,
          traceId: input.traceId,
          runtimeType: input.runtimeType,
          source: "pi_agent_profile",
          metadata,
          recordCompute: false,
        });
        if (costResult.totalUsd > 0) {
          run.costUsd = costResult.llmUsd;
          childSpendRecorded = true;
          await notifyCostRecorded({
            tenantId: input.tenantId,
            agentId: input.agentId,
            agentName: input.agentName ?? "",
            userId: input.userId,
            eventType: "agent_profile_run",
            amountUsd: costResult.totalUsd,
            model: run.model,
          });
        }
      } catch (costErr) {
        console.error(
          `[chat-finalize] Agent Profile cost recording failed:`,
          costErr,
        );
      }
    }

    try {
      await appendThreadTurnEvent(drizzleThreadTurnEventStore(db), {
        tenantId: input.tenantId,
        runId: input.turnId,
        agentId: input.agentId,
        eventType: "agent_profile_run",
        stream: "step",
        level: run.status === "completed" ? "info" : "error",
        color: run.status === "completed" ? "green" : "red",
        message:
          run.status === "completed"
            ? `Agent Profile ${run.profileName} completed on ${run.model}`
            : `Agent Profile ${run.profileName} ${run.status}`,
        payload: {
          profile_run_id: run.profileRunId,
          profile_id: run.profileId,
          profile_slug: run.profileSlug,
          profile_name: run.profileName,
          model: run.model,
          input_tokens: run.inputTokens,
          output_tokens: run.outputTokens,
          cached_read_tokens: run.cachedReadTokens,
          cached_write_tokens: run.cachedWriteTokens,
          total_tokens: run.totalTokens,
          duration_ms: run.durationMs,
          cost_usd: run.costUsd,
          status: run.status,
          lane_key: run.laneKey,
          handoff_summary: run.handoffSummary,
          loop_evidence: run.loopEvidence,
          tool_invocations: run.toolInvocations,
          ...(run.error ? { error: run.error } : {}),
        },
      });
    } catch (eventErr) {
      console.error(
        `[chat-finalize] Agent Profile event recording failed:`,
        eventErr,
      );
    }
  }

  if (childSpendRecorded) {
    try {
      await checkBudgetAndPause(input.tenantId, input.agentId, input.userId);
    } catch (budgetErr) {
      console.error(
        `[chat-finalize] Agent Profile budget check failed:`,
        budgetErr,
      );
    }
  }
}

function aggregateTurnUsage(input: {
  parent: {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens: number;
    costUsd?: number | null;
  };
  modelRoutedToolCalls: ModelRoutedToolCallEvidence[];
  agentProfileRuns: AgentProfileRunEvidence[];
}): {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  costUsd: number | null;
} {
  const inputTokens =
    input.parent.inputTokens +
    input.modelRoutedToolCalls.reduce(
      (sum, call) => sum + call.inputTokens,
      0,
    ) +
    input.agentProfileRuns.reduce((sum, run) => sum + run.inputTokens, 0);
  const outputTokens =
    input.parent.outputTokens +
    input.modelRoutedToolCalls.reduce(
      (sum, call) => sum + call.outputTokens,
      0,
    ) +
    input.agentProfileRuns.reduce((sum, run) => sum + run.outputTokens, 0);
  const cachedReadTokens =
    input.parent.cachedReadTokens +
    input.modelRoutedToolCalls.reduce(
      (sum, call) => sum + call.cachedReadTokens,
      0,
    ) +
    input.agentProfileRuns.reduce((sum, run) => sum + run.cachedReadTokens, 0);
  const costValues = [
    input.parent.costUsd,
    ...input.modelRoutedToolCalls.map((call) => call.costUsd),
    ...input.agentProfileRuns.map((run) => run.costUsd),
  ].filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  return {
    inputTokens,
    outputTokens,
    cachedReadTokens,
    costUsd:
      costValues.length > 0
        ? Math.round(
            costValues.reduce((sum, value) => sum + value, 0) * 1_000_000,
          ) / 1_000_000
        : null,
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function recordWorkspaceReconcileStatus(
  turnId: string,
  result:
    | { status: "complete"; report: unknown }
    | { status: "failed"; error: string },
): Promise<void> {
  await db
    .update(threadTurns)
    .set({
      context_snapshot: sql`jsonb_set(coalesce(${threadTurns.context_snapshot}, '{}'::jsonb), '{workspace_reconcile}', ${JSON.stringify(
        {
          ...result,
          updated_at: new Date().toISOString(),
        },
      )}::jsonb, true)`,
    })
    .where(eq(threadTurns.id, turnId));
}

async function resolveSkillCreatorRequesterUserId(input: {
  tenantId: string;
  threadId: string;
}): Promise<string | null> {
  const [message] = await db
    .select({ senderId: messages.sender_id })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, input.threadId),
        eq(messages.sender_type, "user"),
      ),
    )
    .orderBy(desc(messages.created_at), desc(messages.id))
    .limit(1);
  return message?.senderId ?? null;
}

async function markTurnFinalized(turnId: string): Promise<void> {
  await db
    .update(threadTurns)
    .set({ finalized_at: new Date() })
    .where(eq(threadTurns.id, turnId));
}

export function isHiddenDesktopDelegation(contextSnapshot: unknown): boolean {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return false;
  const snapshot = contextSnapshot as Record<string, unknown>;
  const delegation = snapshot.desktop_managed_delegation;
  if (!delegation || typeof delegation !== "object") return false;
  return (delegation as Record<string, unknown>).visibility === "hidden";
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
  suppressAssistantMessage?: boolean;
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

  if (input.suppressAssistantMessage) return;

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
  return {
    ok: true,
    idempotent: false,
    messageId: result.messageId,
    ...(result.reconcile ? { reconcile: result.reconcile } : {}),
  };
}
