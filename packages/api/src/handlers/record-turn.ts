/**
 * Record a completed on-device harness turn into an existing thread.
 *
 * POST /api/threads/record-turn
 *
 * The mobile harness runs the agent loop on the device and produces the assistant turn
 * itself, so there is no server-side agent to trigger — this endpoint simply appends the
 * user message and the (client-produced) assistant message to an existing thread so they
 * render through the normal message query + AppSync subscription and appear in history.
 *
 * Append-only by design: it does NOT create threads. Thread creation owns `space_id`
 * (a FK into the spaces.* schema, which a standing guardrail keeps off-limits to
 * thread/UI work) and the per-tenant `number` sequence — both live in the existing
 * CreateThread path, which the client uses to obtain `threadId` before recording turns.
 *
 *   200 → { threadId, userMessageId, assistantMessageId }
 *   401 → unauthenticated
 *   403 → authenticated but no tenant resolved
 *   404 → thread not found for the caller's tenant (also guards cross-tenant append)
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../lib/cognito-auth.js";
import {
  handleCors,
  json,
  error,
  unauthorized,
  forbidden,
  notFound,
} from "../lib/response.js";
import { db } from "../lib/db.js";
import { schema } from "@thinkwork/database-pg";

const { users, threads, messages } = schema;

interface RecordTurnBody {
  threadId?: string;
  userText?: string;
  assistantText?: string;
  toolResults?: unknown[];
  usage?: { inputTokens?: number; outputTokens?: number };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || auth.authType !== "cognito" || !auth.email) {
    return unauthorized("Authentication required");
  }

  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.email, auth.email.toLowerCase()))
    .limit(1);
  if (!userRow || !userRow.tenant_id) {
    return forbidden("No tenant resolved for caller");
  }
  const tenantId = userRow.tenant_id;

  let body: RecordTurnBody;
  try {
    body = JSON.parse(event.body ?? "{}") as RecordTurnBody;
  } catch {
    return error("Invalid JSON body", 400);
  }
  if (!body.threadId) return error("threadId is required", 400);
  if (!body.userText || !body.assistantText) {
    return error("userText and assistantText are required", 400);
  }

  // Thread must exist AND belong to the caller's tenant (guards cross-tenant append).
  const [thread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, body.threadId), eq(threads.tenant_id, tenantId)))
    .limit(1);
  if (!thread) return notFound("Thread not found");

  const [userMessage] = await db
    .insert(messages)
    .values({
      thread_id: body.threadId,
      tenant_id: tenantId,
      role: "user",
      content: body.userText,
      sender_type: "user",
      sender_id: userRow.id,
    })
    .returning({ id: messages.id });

  const [assistantMessage] = await db
    .insert(messages)
    .values({
      thread_id: body.threadId,
      tenant_id: tenantId,
      role: "assistant",
      content: body.assistantText,
      sender_type: "agent",
      tool_results: body.toolResults ?? null,
      token_count:
        (body.usage?.inputTokens ?? 0) + (body.usage?.outputTokens ?? 0) ||
        null,
    })
    .returning({ id: messages.id });

  return json({
    threadId: body.threadId,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
  });
}
