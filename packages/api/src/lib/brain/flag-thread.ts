/**
 * Brain thread-flag client (THINK-781).
 *
 * Builds and posts a "Send to the Brain" flag to the Brain ops API as a
 * Cortex submission (`POST {brain_ops_api}/submissions` with
 * `kind: "flag"` — the THINK-814 front door that replaced the original
 * `POST /flags` intake; the Brain kept `/flags` only as a compatibility
 * alias for agents not yet on this contract). The ops base URL is derived
 * from the tenant's provisioned Brain MCP URL the same way the KB surface
 * is (`/mcp` or `/mcp/twin` suffix stripped); auth is the account's
 * existing Brain m2m bearer resolved by the connector machinery — the
 * submissions door sits under the same `etl-agent/tasks` machine scope
 * the retired route used.
 *
 * The Brain validates server-side; these caps mirror its limits so an
 * oversize conversation is truncated defensively client-side instead of
 * bouncing with a 400:
 *   - 200 conversation messages (oldest dropped first),
 *   - 8000 chars per message text,
 *   - 4000-char note,
 *   - 500-char identifier fields.
 */

import {
  extractMessageText,
  type ThreadMessageRow,
} from "../evals/thread-snapshot.js";
import { postBrainOps } from "./ops-post.js";

export const BRAIN_FLAG_MAX_CONVERSATION_MESSAGES = 200;
export const BRAIN_FLAG_MAX_MESSAGE_TEXT_CHARS = 8000;
export const BRAIN_FLAG_MAX_NOTE_CHARS = 4000;
export const BRAIN_FLAG_MAX_IDENTIFIER_CHARS = 500;

export interface BrainFlagConversationMessage {
  role: "user" | "assistant";
  at?: string;
  text: string;
}

export interface BrainFlagPayload {
  source: "thinkwork-agent";
  thread_id: string;
  thread_url?: string;
  flagged_by?: string;
  note: string;
  conversation: BrainFlagConversationMessage[];
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Derive the Brain ops-API `/submissions` URL from the connector's MCP URL
 * (`https://mcp.brain.thinkwork.ai/mcp` or `.../mcp/twin` →
 * `.../submissions`) — the same suffix rewrite `twinKbUrlFrom` uses for
 * the KB surface.
 */
export function brainSubmissionsUrlFrom(mcpUrl: string): string {
  const base = mcpUrl.replace(/\/mcp(\/twin)?\/?$/, "").replace(/\/+$/, "");
  return `${base}/submissions`;
}

/**
 * Serialize the raw thread into the Brain's `conversation` shape — same
 * text fidelity the eval flag captures (content column first, then typed
 * text/response parts, so pasted content rides along verbatim), capped
 * defensively to the Brain's limits. Only user/assistant messages carry
 * conversational text the triage needs; system/tool rows are skipped.
 */
export function buildBrainFlagConversation(
  rows: ThreadMessageRow[],
): BrainFlagConversationMessage[] {
  const conversation: BrainFlagConversationMessage[] = [];
  for (const row of rows) {
    const role = String(row.role ?? "")
      .trim()
      .toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const text = extractMessageText(row);
    if (!text || text.trim().length === 0) continue;
    const at = toIso(row.created_at ?? null);
    conversation.push({
      role,
      ...(at ? { at } : {}),
      text: truncate(text, BRAIN_FLAG_MAX_MESSAGE_TEXT_CHARS),
    });
  }
  // Cap at 200 messages, dropping the oldest — the flagged answer is at
  // the recent end of the thread.
  return conversation.length > BRAIN_FLAG_MAX_CONVERSATION_MESSAGES
    ? conversation.slice(
        conversation.length - BRAIN_FLAG_MAX_CONVERSATION_MESSAGES,
      )
    : conversation;
}

export function buildBrainFlagPayload(input: {
  threadId: string;
  threadUrl: string | null;
  flaggedBy: string | null;
  note: string;
  messages: ThreadMessageRow[];
}): BrainFlagPayload {
  const threadUrl = input.threadUrl?.trim() || null;
  const flaggedBy = input.flaggedBy?.trim() || null;
  return {
    source: "thinkwork-agent",
    thread_id: truncate(input.threadId, BRAIN_FLAG_MAX_IDENTIFIER_CHARS),
    ...(threadUrl
      ? { thread_url: truncate(threadUrl, BRAIN_FLAG_MAX_IDENTIFIER_CHARS) }
      : {}),
    ...(flaggedBy
      ? { flagged_by: truncate(flaggedBy, BRAIN_FLAG_MAX_IDENTIFIER_CHARS) }
      : {}),
    note: truncate(input.note.trim(), BRAIN_FLAG_MAX_NOTE_CHARS),
    conversation: buildBrainFlagConversation(input.messages),
  };
}

export type PostBrainFlagResult =
  | {
      kind: "accepted";
      flagId: string;
      taskId: string | null;
      note: string | null;
    }
  | { kind: "rejected"; status: number; message: string }
  | { kind: "unreachable"; message: string };

/**
 * POST the flag to the Brain ops API as a `kind: "flag"` submission. 2xx
 * with a submission_id is acceptance (202 per contract; task_id may be
 * absent when the Brain accepted the flag but could not immediately
 * dispatch — that is still success). 4xx is validation feedback to
 * surface verbatim; 5xx / network errors / timeouts are retryable
 * ("couldn't reach the Brain").
 *
 * The flag body rides unchanged as the envelope's `payload` — the Brain
 * validates it with the same fences the retired `/flags` route ran. The
 * flagger's email additionally travels as the envelope's `submitted_by`,
 * the assertion about the PERSON the submission row stores beside the
 * server-derived machine principal.
 */
export async function postBrainFlag(input: {
  submissionsUrl: string;
  token: string | null;
  headers?: Record<string, string>;
  payload: BrainFlagPayload;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PostBrainFlagResult> {
  const result = await postBrainOps({
    url: input.submissionsUrl,
    idField: "submission_id",
    token: input.token,
    headers: input.headers,
    payload: {
      kind: "flag",
      payload: input.payload,
      ...(input.payload.flagged_by
        ? { submitted_by: input.payload.flagged_by }
        : {}),
    },
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  if (result.kind !== "accepted") return result;
  return {
    kind: "accepted",
    flagId: result.id,
    taskId: result.taskId,
    note: result.note,
  };
}
