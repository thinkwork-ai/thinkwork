/**
 * ask_user_question intake — POST /api/threads/{threadId}/questions
 * (plan 2026-06-09-005 U2).
 *
 * The Pi runtime's ask_user_question extension POSTs a question batch here
 * (awaited) before returning its sentinel tool result. Served by the SAME
 * Lambda as chat-agent-activity (route discrimination in that handler —
 * no new Lambda); terraform maps the route to "chat-agent-activity".
 *
 *   Authorization: Bearer <API_AUTH_SECRET>
 *   body: { thread_turn_id, questions: [...], delegation_context? }
 *
 *   → 200 { ok: true, questionId, messageId }
 *   → 400 BAD_REQUEST          -- payload contract violation
 *   → 401 UNAUTHORIZED         -- bearer missing/wrong
 *   → 403 TURN_NOT_ACTIVE / TENANT_MISMATCH
 *   → 404 TURN_NOT_FOUND / THREAD_NOT_FOUND
 *   → 409 QUESTION_ALREADY_PENDING -- partial unique index conflict (R8)
 *
 * Security-critical ownership join: the bearer secret alone is NOT enough
 * to post a question into an arbitrary thread. The payload's
 * thread_turn_id must resolve to a turn that (a) exists, (b) belongs to
 * the {threadId} in the path, and (c) is still active (queued|running —
 * the tool call happens mid-turn); and the thread row's tenant_id must
 * match the turn's tenant_id.
 *
 * In ONE transaction: insert the assistant question message (content =
 * markdown fallback, parts = data-user-question) and the
 * pending_user_questions row. The partial unique index
 * (one 'pending' row per thread) maps to 409 — the transaction rolls the
 * message back, so a conflicting ask leaves no orphan card.
 *
 * After commit, notifyNewMessage + notifyThreadUpdate are AWAITED — this
 * runs behind Lambda Web Adapter, where only awaited promises are
 * guaranteed to complete (docs/solutions/runtime-errors/
 * lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md) — but
 * individually guarded (log + continue): once the question row is
 * committed the endpoint must return 200, or the tool reports failure
 * and the pending row is orphaned.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  messages,
  pendingUserQuestions,
  threads,
  threadTurns,
} from "@thinkwork/database-pg/schema";
import { extractBearerToken, validateApiSecret } from "../auth.js";
import { hasPgErrorCode } from "../pg-utils.js";
import { notifyNewMessage, notifyThreadUpdate } from "../../graphql/notify.js";
import {
  renderQuestionMarkdown,
  userQuestionPart,
  validateQuestionBatch,
  type UserQuestionInput,
} from "./question-message.js";

const db = getDb();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ask happens mid-turn; anything past these states is a stale caller. */
const ACTIVE_TURN_STATUSES = new Set(["queued", "running"]);

interface QuestionIntakePayload {
  thread_turn_id: string;
  questions: UserQuestionInput[];
  delegation_context?: Record<string, unknown> | null;
}

function json(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function badRequest(reason: string): APIGatewayProxyStructuredResultV2 {
  return json(400, { ok: false, error: reason, code: "BAD_REQUEST" });
}

export async function handleQuestionIntake(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  // ---- Auth (same service-endpoint bearer as chat-agent-activity) ------
  const token = extractBearerToken(event);
  if (!token || !validateApiSecret(token)) {
    return json(401, {
      ok: false,
      error: "Missing or invalid Bearer token",
      code: "UNAUTHORIZED",
    });
  }

  // ---- Method gate ------------------------------------------------------
  if (event.requestContext.http.method !== "POST") {
    return json(405, {
      ok: false,
      error: "Method not allowed",
      code: "METHOD_NOT_ALLOWED",
    });
  }

  // ---- Path param + body parse -------------------------------------------
  const pathThreadId = event.pathParameters?.threadId;
  if (!pathThreadId || !UUID_RE.test(pathThreadId)) {
    return badRequest("Missing or invalid threadId path parameter");
  }

  let payload: QuestionIntakePayload;
  try {
    payload = JSON.parse(event.body || "{}") as QuestionIntakePayload;
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (!payload.thread_turn_id || !UUID_RE.test(payload.thread_turn_id)) {
    return badRequest("Missing or invalid thread_turn_id");
  }

  const validationError = validateQuestionBatch(
    payload.questions,
    payload.delegation_context ?? undefined,
  );
  if (validationError) {
    return badRequest(validationError);
  }
  const questions = payload.questions;

  // ---- Ownership join (security-critical) -------------------------------
  // The secret is shared service auth; the turn row is what scopes the
  // request to a tenant + thread. A secret-holder cannot post questions
  // into arbitrary threads.
  const [turn] = await db
    .select({
      id: threadTurns.id,
      tenant_id: threadTurns.tenant_id,
      thread_id: threadTurns.thread_id,
      agent_id: threadTurns.agent_id,
      status: threadTurns.status,
    })
    .from(threadTurns)
    .where(eq(threadTurns.id, payload.thread_turn_id))
    .limit(1);

  if (!turn) {
    return json(404, {
      ok: false,
      error: "thread_turn_id not found",
      code: "TURN_NOT_FOUND",
    });
  }
  if (turn.thread_id !== pathThreadId) {
    // Don't reveal whether the turn exists elsewhere.
    return json(404, {
      ok: false,
      error: "thread_turn_id not found for this thread",
      code: "TURN_NOT_FOUND",
    });
  }
  if (!ACTIVE_TURN_STATUSES.has(turn.status)) {
    return json(403, {
      ok: false,
      error: `thread turn is not active (status: ${turn.status})`,
      code: "TURN_NOT_ACTIVE",
    });
  }

  const [thread] = await db
    .select({
      id: threads.id,
      tenant_id: threads.tenant_id,
      status: threads.status,
      title: threads.title,
    })
    .from(threads)
    .where(eq(threads.id, pathThreadId))
    .limit(1);

  if (!thread) {
    return json(404, {
      ok: false,
      error: "thread not found",
      code: "THREAD_NOT_FOUND",
    });
  }
  if (thread.tenant_id !== turn.tenant_id) {
    return json(403, {
      ok: false,
      error: "thread tenant does not match turn tenant",
      code: "TENANT_MISMATCH",
    });
  }

  const tenantId = turn.tenant_id;
  const questionId = randomUUID();
  const content = renderQuestionMarkdown(questions);
  const parts = [userQuestionPart(questionId, questions)];

  // ---- One transaction: question message + pending row -------------------
  let messageId: string;
  try {
    messageId = await db.transaction(async (tx) => {
      const [messageRow] = await tx
        .insert(messages)
        .values({
          thread_id: pathThreadId,
          tenant_id: tenantId,
          role: "assistant",
          content,
          parts,
          sender_type: "agent",
          sender_id: turn.agent_id ?? null,
        })
        .returning({ id: messages.id });

      await tx.insert(pendingUserQuestions).values({
        id: questionId,
        tenant_id: tenantId,
        thread_id: pathThreadId,
        message_id: messageRow.id,
        thread_turn_id: turn.id,
        status: "pending",
        questions,
        delegation_context: payload.delegation_context ?? null,
      });

      return messageRow.id;
    });
  } catch (err) {
    if (hasPgErrorCode(err, "23505")) {
      // Partial unique index: one 'pending' row per thread (R8). The
      // transaction rolled the message insert back — no orphan card.
      return json(409, {
        ok: false,
        error: "a question is already pending for this thread",
        code: "QUESTION_ALREADY_PENDING",
      });
    }
    console.error(`[question-intake] transaction failed:`, err);
    return json(500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: "INTERNAL",
    });
  }

  // ---- Fan-out (AWAITED — LWA in-flight promise lifecycle) ----------------
  // Each notify is individually guarded: the question row is COMMITTED at
  // this point, so a notify throw must not turn the response into a
  // non-200 — the tool would report failure, skip its sentinel, and leave
  // an orphan pending row the agent never waits on.
  try {
    await notifyNewMessage({
      messageId,
      threadId: pathThreadId,
      tenantId,
      role: "assistant",
      content,
      senderType: "agent",
      senderId: turn.agent_id ?? undefined,
    });
  } catch (err) {
    console.error(
      `[question-intake] notifyNewMessage failed for thread=${pathThreadId} question=${questionId}:`,
      err,
    );
  }
  try {
    await notifyThreadUpdate({
      threadId: pathThreadId,
      tenantId,
      status: thread.status,
      title: thread.title,
    });
  } catch (err) {
    console.error(
      `[question-intake] notifyThreadUpdate failed for thread=${pathThreadId} question=${questionId}:`,
      err,
    );
  }

  return json(200, { ok: true, questionId, messageId });
}
