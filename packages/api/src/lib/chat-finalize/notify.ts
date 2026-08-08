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

import { messages } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";
import { validateChartMessagePart } from "@thinkwork/chart-renderer";
import { validateMcpAppPart } from "@thinkwork/pi-runtime-core";
import { validateThreadJsonRenderPart } from "@thinkwork/thread-json-render";
import { publishAppSyncMutation } from "../appsync-iam-publisher.js";
import { stripNulDeep } from "./sanitize.js";

const db = getDb();

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
  uiMessageParts?: Array<Record<string, unknown>>,
  extraMetadata?: Record<string, unknown>,
): Promise<{ id: string } | null> {
  try {
    const toolInvocationMetadata =
      toolInvocations && toolInvocations.length > 0
        ? {
            tool_invocations: toolInvocations.map((inv) => {
              const { genui_data: _, ...rest } = inv;
              return rest;
            }),
          }
        : {};
    const metadata =
      Object.keys(toolInvocationMetadata).length > 0 ||
      (extraMetadata && Object.keys(extraMetadata).length > 0)
        ? {
            ...toolInvocationMetadata,
            ...(extraMetadata ?? {}),
          }
        : undefined;

    const [row] = await db
      .insert(messages)
      .values({
        thread_id: threadId,
        tenant_id: tenantId,
        role: "assistant",
        content: stripNulDeep(content),
        sender_type: "agent",
        sender_id: agentId,
        parts:
          stripNulDeep(normalizeUiMessageParts(uiMessageParts)) || undefined,
        metadata: stripNulDeep(metadata),
      })
      .returning({ id: messages.id });

    console.log(`[chat-finalize] Inserted assistant message: ${row.id}`);
    return row;
  } catch (err) {
    console.error(`[chat-finalize] Failed to insert assistant message:`, err);
    return null;
  }
}

/**
 * Server-side gate for every durable UI message part the runtime hands back:
 * each candidate must validate against its own part contract or it is dropped,
 * and the survivors are deduped by id (last write wins). Three part families
 * ride this list today — `data-json-render`, `mcp-app`, and `data-chart`
 * (THINK-672).
 */
export function normalizeUiMessageParts(
  parts: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const byId = new Map<string, Record<string, unknown>>();
  for (const part of parts) {
    const jsonRenderResult = validateThreadJsonRenderPart(part);
    if (jsonRenderResult.ok) {
      byId.set(
        jsonRenderResult.part.id,
        jsonRenderResult.part as unknown as Record<string, unknown>,
      );
      continue;
    }
    const mcpAppResult = validateMcpAppPart(part);
    if (mcpAppResult.ok) {
      byId.set(
        mcpAppResult.part.id,
        mcpAppResult.part as unknown as Record<string, unknown>,
      );
      continue;
    }
    const chartPart = validateChartMessagePart(part);
    if (chartPart) {
      byId.set(chartPart.id, chartPart as unknown as Record<string, unknown>);
    }
  }
  return byId.size > 0 ? [...byId.values()] : null;
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

  await publishAppSyncMutation(mutation, {
    ...payload,
    ownerType:
      payload.senderType === "assistant" ? "agent" : payload.senderType,
    ownerId: payload.senderId,
  });
}

export async function notifyThreadTurnUpdate(payload: {
  runId: string;
  tenantId: string;
  threadId: string;
  agentId: string;
  status: string;
  triggerName: string | null;
}): Promise<void> {
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

  await publishAppSyncMutation(mutation, payload);
}

export async function markComputerTaskFailedFromFinalize(_input: {
  tenantId: string;
  computerId?: string | null;
  taskId?: string | null;
  threadId: string;
  messageId?: string | null;
  message: string;
  code: string;
}): Promise<void> {
  // Computer feature removed; the callback substrate that surfaced
  // task failures into computer_tasks/computer_events is gone. Callers
  // are kept in place pending broader chat-finalize refactor.
  return;
}
