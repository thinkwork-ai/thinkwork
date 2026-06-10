/**
 * answerUserQuestion — the structured-card answer route
 * (plan 2026-06-09-005 U3; R22 idempotent answer→resume).
 *
 * Flow: auth → load question row → thread-visibility check → CAS-consume
 * (all pending rows for the thread, answeredVia 'card') → enqueue the
 * resume wakeup → return the answered UserQuestion.
 *
 * Wakeup contract (mirrors the producer-side wakeup-defer contract):
 *   - source `question_answer`, idempotency_key `question-answer:<id>`
 *   - payload carries `threadId` at the TOP LEVEL — the exact key
 *     promoteNextDeferredWakeup() matches on (payload->>'threadId')
 *   - shouldDeferWakeup(): insert status 'deferred' while a turn is
 *     running, else 'queued'. Queued wakeups are picked up by the
 *     wakeup-processor's EventBridge poll (once per minute) — there is no
 *     producer-side "kick" Lambda; every existing producer relies on the
 *     same poll.
 *
 * Failure semantics (R22, no silent success): when the enqueue fails —
 * insert error, missing agent, or an existing row already holding the
 * idempotency key (the find-then-insert equivalent of ON CONFLICT
 * inserted=false; agent_wakeup_requests has no unique index on
 * idempotency_key, so producers use find-then-insert, see
 * default-agent-routing.ts) — the mutation throws so the card can show a
 * retry. NOTE the question row STAYS answered in that case: the CAS
 * already committed. v1 recovery is a manual re-trigger (the
 * answered-no-resume reconciler is explicitly deferred — see plan
 * "Scope Boundaries").
 */

import { GraphQLError } from "graphql";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentWakeupRequests,
  pendingUserQuestions,
  threads,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { callerVisibleThreadPredicate } from "../threads/access.js";
import { shouldDeferWakeup } from "../../../lib/wakeup-defer.js";
import { consumePendingQuestions } from "../../../lib/user-questions/consume.js";
import { notifyThreadUpdate } from "../../notify.js";
import { userQuestionToGraphql } from "./user-question.shared.js";

const db = getDb();

export const answerUserQuestion = async (
  _parent: unknown,
  args: { questionId: string; answers: string },
  ctx: GraphQLContext,
) => {
  // ---- Input ------------------------------------------------------------
  let parsedAnswers: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(args.answers);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("answers must be a JSON object");
    }
    parsedAnswers = parsed as Record<string, unknown>;
  } catch {
    throw new GraphQLError("answers must be a JSON object", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  // ---- Caller identity (sendMessage conventions) -------------------------
  // ctx.auth.tenantId is null for Google-federated users; resolveCallerFromAuth
  // resolves both userId and tenantId from the users row (the
  // resolveCallerTenantId fallback semantics).
  const caller = await resolveCallerFromAuth(ctx.auth);
  if (ctx.auth.authType === "cognito" && !caller.userId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  // ---- Load the question row ---------------------------------------------
  const [question] = await db
    .select()
    .from(pendingUserQuestions)
    .where(eq(pendingUserQuestions.id, args.questionId))
    .limit(1);
  if (!question || !caller.tenantId || question.tenant_id !== caller.tenantId) {
    // Cross-tenant probes get the same answer as a missing id.
    throw new GraphQLError("Question not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  // ---- Thread-level access (same predicate as sendMessage/threads) -------
  // Any thread PARTICIPANT may answer; a same-tenant non-participant is
  // rejected (plan security vector #1).
  if (ctx.auth.authType === "cognito") {
    const [visibleThread] = await db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.id, question.thread_id),
          eq(threads.tenant_id, question.tenant_id),
          callerVisibleThreadPredicate(question.tenant_id, caller.userId!),
        ),
      );
    if (!visibleThread) {
      throw new GraphQLError("Thread does not belong to requester", {
        extensions: { code: "FORBIDDEN" },
      });
    }
  }

  // ---- Status pre-check (friendly error before the CAS) ------------------
  if (question.status !== "pending") {
    throw alreadyAnsweredError(question.status);
  }

  // ---- CAS consume (card route) -------------------------------------------
  const consumed = await consumePendingQuestions(db, {
    threadId: question.thread_id,
    answeredVia: "card",
    answers: parsedAnswers,
    answeredBy: caller.userId ?? null,
  });
  const winnerRow = consumed.find((row) => row.id === question.id);
  if (!winnerRow) {
    // Zero rows (or a different orphan row) consumed — this caller lost the
    // race (double card submit, or a plain reply got there first).
    throw alreadyAnsweredError("answered");
  }

  // ---- Resume wakeup (winner only) ----------------------------------------
  const [thread] = await db
    .select({
      agent_id: threads.agent_id,
      status: threads.status,
      title: threads.title,
    })
    .from(threads)
    .where(
      and(
        eq(threads.id, question.thread_id),
        eq(threads.tenant_id, question.tenant_id),
      ),
    )
    .limit(1);

  let agentId = thread?.agent_id ?? null;
  if (!agentId) {
    // The asking turn was agent-driven, so threads.agent_id is normally set;
    // fall back to the tenant platform agent before failing loudly.
    try {
      const { resolveTenantPlatformAgent } =
        await import("../../../lib/agents/tenant-platform-agent.js");
      agentId = (await resolveTenantPlatformAgent(question.tenant_id, db)).id;
    } catch {
      agentId = null;
    }
  }
  if (!agentId) {
    throw enqueueFailedError(
      "No agent is available to resume this thread; the answer was recorded — re-trigger the agent to resume.",
    );
  }

  const idempotencyKey = `question-answer:${question.id}`;
  const wakeupPayload = {
    // TOP-LEVEL threadId — promoteNextDeferredWakeup() matches on
    // payload->>'threadId'; do not nest or rename this key.
    threadId: question.thread_id,
    questionId: question.id,
    questions: question.questions,
    answers: parsedAnswers,
    answeredVia: "card",
    answeredBy: caller.userId ?? null,
    delegationContext: question.delegation_context ?? null,
  };

  try {
    // Producer-side defer contract: never queue a second concurrent turn.
    const defer = await shouldDeferWakeup(question.thread_id);

    // Find-then-insert (the table has no unique index on idempotency_key —
    // same producer shape as default-agent-routing.ts). An existing row is
    // the inserted=false case: surfaced loudly, never swallowed (R22).
    const [existing] = await db
      .select({ id: agentWakeupRequests.id })
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.tenant_id, question.tenant_id),
          eq(agentWakeupRequests.agent_id, agentId),
          eq(agentWakeupRequests.idempotency_key, idempotencyKey),
        ),
      );
    if (existing) {
      console.error(
        `[answerUserQuestion] resume wakeup already exists (inserted=false) key=${idempotencyKey} wakeup=${existing.id}`,
      );
      throw enqueueFailedError(
        "The resume wakeup for this answer already exists; the answer was recorded — re-trigger the agent if it does not resume.",
      );
    }

    const [created] = await db
      .insert(agentWakeupRequests)
      .values({
        tenant_id: question.tenant_id,
        agent_id: agentId,
        source: "question_answer",
        reason: "User answered a pending question",
        trigger_detail: `question:${question.id}`,
        payload: wakeupPayload,
        status: defer ? "deferred" : "queued",
        idempotency_key: idempotencyKey,
        requested_by_actor_type: "user",
        requested_by_actor_id: caller.userId ?? null,
      })
      .returning({ id: agentWakeupRequests.id });
    if (!created?.id) {
      throw enqueueFailedError(
        "Failed to enqueue the resume wakeup; the answer was recorded — retry to resume the agent.",
      );
    }
  } catch (err) {
    if (err instanceof GraphQLError) throw err;
    console.error(
      `[answerUserQuestion] resume wakeup enqueue failed for question=${question.id}:`,
      err,
    );
    throw enqueueFailedError(
      "Failed to enqueue the resume wakeup; the answer was recorded — retry to resume the agent.",
    );
  }

  // The AWAITING_USER badge clears on this thread-update event (the same
  // event consumers already subscribe to — no separate dismissal signal).
  notifyThreadUpdate({
    threadId: question.thread_id,
    tenantId: question.tenant_id,
    status: thread?.status ?? "in_progress",
    title: thread?.title ?? "",
  }).catch(() => {});

  return userQuestionToGraphql(winnerRow);
};

function alreadyAnsweredError(status: string) {
  return new GraphQLError(
    status === "cancelled"
      ? "This question was cancelled"
      : "This question has already been answered",
    {
      extensions: { code: "QUESTION_ALREADY_ANSWERED" },
    },
  );
}

function enqueueFailedError(message: string) {
  return new GraphQLError(message, {
    extensions: { code: "WAKEUP_ENQUEUE_FAILED" },
  });
}
