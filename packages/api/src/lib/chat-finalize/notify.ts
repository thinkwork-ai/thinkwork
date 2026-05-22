/**
 * Notification + message-insert helpers lifted from chat-agent-invoke.ts
 * (plan 2026-05-22-006 U1). These were inline utility functions on the
 * post-AgentCore code path; they're shared between the new
 * chat-agent-finalize handler (the normal path) and chat-agent-invoke's
 * pre-dispatch error paths (which still surface error messages inline).
 *
 * Behavior is **deliberately identical** to the prior inline versions —
 * same log prefixes (with a `[chat-finalize]` substitution where the
 * literal `[chat-agent-invoke]` prefix would obscure call origin), same
 * field shapes, same error-swallowing semantics. Do not "improve" this
 * file in the lift; that belongs in a follow-up.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computerEvents,
  computerTasks,
  messages,
} from "@thinkwork/database-pg/schema";

const db = getDb();

const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT || "";
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY || "";

export const GENERIC_AGENT_ERROR_MESSAGE =
  "I'm sorry, I encountered an error processing your request. Please try again.";

/** Extract plain text from AgentCore response (handles ChatCompletion, raw text, etc.) */
export function extractResponseText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return String(data);

  const obj = data as Record<string, unknown>;

  // OpenAI ChatCompletion format: { choices: [{ message: { content: "..." } }] }
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const first = obj.choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string") return message.content;
  }

  // Direct content fields
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.response === "string") return obj.response;
  if (typeof obj.output === "string") return obj.output;
  if (typeof obj.text === "string") return obj.text;

  // Nested response object
  if (obj.response && typeof obj.response === "object") {
    return extractResponseText(obj.response);
  }

  return JSON.stringify(data);
}

export async function insertAssistantMessage(
  threadId: string,
  tenantId: string,
  agentId: string,
  content: string,
  toolInvocations?: Array<Record<string, unknown>>,
): Promise<{ id: string } | null> {
  try {
    // Extract GenUI data from tool invocations (typed JSON with _type field)
    // MCP tools return _type JSON directly (Places, CRM, Tasks)
    const genuiResults = (toolInvocations || [])
      .filter((inv) => inv.genui_data)
      .flatMap((inv) =>
        Array.isArray(inv.genui_data) ? inv.genui_data : [inv.genui_data],
      )
      .filter(
        (item): item is Record<string, unknown> =>
          item !== null &&
          typeof item === "object" &&
          "_type" in (item as Record<string, unknown>),
      );

    const [row] = await db
      .insert(messages)
      .values({
        thread_id: threadId,
        tenant_id: tenantId,
        role: "assistant",
        content,
        sender_type: "agent",
        sender_id: agentId,
        tool_results: genuiResults.length > 0 ? genuiResults : undefined,
        metadata:
          toolInvocations && toolInvocations.length > 0
            ? {
                tool_invocations: toolInvocations.map((inv) => {
                  const { genui_data: _, ...rest } = inv;
                  return rest;
                }),
              }
            : undefined,
      })
      .returning({ id: messages.id });

    console.log(
      `[chat-finalize] Inserted assistant message: ${row.id}${genuiResults.length > 0 ? ` (${genuiResults.length} genui results)` : ""}`,
    );
    return row;
  } catch (err) {
    console.error(`[chat-finalize] Failed to insert assistant message:`, err);
    return null;
  }
}

export async function notifyNewMessage(payload: {
  messageId: string;
  threadId: string;
  tenantId: string;
  role: string;
  content: string;
  senderType: string;
  senderId: string;
}): Promise<void> {
  if (!APPSYNC_ENDPOINT || !APPSYNC_API_KEY) {
    console.warn(
      `[chat-finalize] AppSync not configured, skipping notification`,
    );
    return;
  }

  const mutation = `
    mutation NotifyNewMessage(
      $messageId: ID!
      $threadId: ID!
      $tenantId: ID!
      $role: String!
      $content: String!
      $senderType: String
      $senderId: ID
      $ownerType: String
      $ownerId: ID
    ) {
      notifyNewMessage(
        messageId: $messageId
        threadId: $threadId
        tenantId: $tenantId
        role: $role
        content: $content
        senderType: $senderType
        senderId: $senderId
        ownerType: $ownerType
        ownerId: $ownerId
      ) {
        messageId
        threadId
        tenantId
        role
        content
        senderType
        senderId
        ownerType
        ownerId
        createdAt
      }
    }
  `;

  try {
    const response = await fetch(APPSYNC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APPSYNC_API_KEY,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          ...payload,
          ownerType:
            payload.senderType === "assistant" ? "agent" : payload.senderType,
          ownerId: payload.senderId,
        },
      }),
    });

    const responseBody = await response.text();
    if (!response.ok) {
      console.error(
        `[chat-finalize] AppSync notify failed: ${response.status} ${responseBody}`,
      );
    } else {
      // Log GraphQL errors even on HTTP 200
      if (responseBody.includes('"errors"')) {
        console.error(
          `[chat-finalize] AppSync notify GraphQL errors: ${responseBody}`,
        );
      } else {
        console.log(
          `[chat-finalize] AppSync notifyNewMessage sent for ${payload.messageId}`,
        );
      }
    }
  } catch (err) {
    console.error(`[chat-finalize] AppSync notify error:`, err);
  }
}

export async function notifyThreadTurnUpdate(payload: {
  runId: string;
  tenantId: string;
  threadId: string;
  agentId: string;
  status: string;
  triggerName: string | null;
}): Promise<void> {
  if (!APPSYNC_ENDPOINT || !APPSYNC_API_KEY) return;

  const mutation = `
    mutation NotifyThreadTurnUpdate(
      $runId: ID!
      $tenantId: ID!
      $threadId: ID
      $agentId: ID
      $status: String!
      $triggerName: String
    ) {
      notifyThreadTurnUpdate(
        runId: $runId
        tenantId: $tenantId
        threadId: $threadId
        agentId: $agentId
        status: $status
        triggerName: $triggerName
      ) {
        runId
        tenantId
        threadId
        agentId
        status
        triggerName
        updatedAt
      }
    }
  `;

  try {
    await fetch(APPSYNC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APPSYNC_API_KEY,
      },
      body: JSON.stringify({ query: mutation, variables: payload }),
    });
  } catch (err) {
    console.error(`[chat-finalize] notifyThreadTurnUpdate error:`, err);
  }
}

export async function markComputerTaskFailedFromFinalize(input: {
  tenantId: string;
  computerId?: string | null;
  taskId?: string | null;
  threadId: string;
  messageId?: string | null;
  message: string;
  code: string;
}): Promise<void> {
  if (!input.computerId || !input.taskId) return;
  const error = { message: input.message, code: input.code };
  try {
    const [task] = await db
      .update(computerTasks)
      .set({
        status: "failed",
        error,
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(
        and(
          eq(computerTasks.tenant_id, input.tenantId),
          eq(computerTasks.computer_id, input.computerId),
          eq(computerTasks.id, input.taskId),
        ),
      )
      .returning({ id: computerTasks.id });

    if (!task) return;

    await db.insert(computerEvents).values({
      tenant_id: input.tenantId,
      computer_id: input.computerId,
      task_id: input.taskId,
      event_type: "task_failed",
      level: "error",
      payload: {
        threadId: input.threadId,
        messageId: input.messageId ?? null,
        error,
        source: "chat-finalize",
      },
    });
  } catch (taskErr) {
    console.error(
      `[chat-finalize] Failed to mark computer task failed:`,
      taskErr,
    );
  }
}
