/**
 * Brain teaching client (THINK-784).
 *
 * Builds and posts a "Teach the Brain" statement to the Brain ops API
 * (`POST {brain_ops_api}/teachings`) — same base URL and agent-identity
 * m2m bearer as `/flags` (THINK-781). The Brain files a teaching-distill
 * investigation, drafts attributed knowledge, and routes it to an
 * operator for admission; nothing is published unreviewed.
 *
 * Caps mirror the Brain's server-side limits so oversize input is
 * truncated defensively instead of bouncing with a 400:
 *   - 4000-char statement text,
 *   - 500-char identifier fields (taught_by / source / domain / URL).
 */

import { postBrainOps, type PostBrainOpsResult } from "./ops-post.js";

export const BRAIN_TEACHING_MAX_TEXT_CHARS = 4000;
export const BRAIN_TEACHING_MAX_IDENTIFIER_CHARS = 500;

export interface BrainTeachingPayload {
  source: "thinkwork-agent";
  taught_by: string;
  domain?: string;
  text: string;
  context_thread_url?: string;
  /** Expert-question id this teaching answers (THINK-787); must be a UUID. */
  answers_question_id?: string;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Derive the ops-API `/teachings` URL — same base rewrite as `/flags`. */
export function brainTeachingsUrlFrom(mcpUrl: string): string {
  const base = mcpUrl.replace(/\/mcp(\/twin)?\/?$/, "").replace(/\/+$/, "");
  return `${base}/teachings`;
}

export function buildBrainTeachingPayload(input: {
  taughtBy: string;
  text: string;
  domain?: string | null;
  contextThreadUrl?: string | null;
  answersQuestionId?: string | null;
}): BrainTeachingPayload {
  const domain = input.domain?.trim() || null;
  const contextThreadUrl = input.contextThreadUrl?.trim() || null;
  const answersQuestionId = input.answersQuestionId?.trim() || null;
  return {
    source: "thinkwork-agent",
    taught_by: truncate(
      input.taughtBy.trim(),
      BRAIN_TEACHING_MAX_IDENTIFIER_CHARS,
    ),
    ...(domain
      ? { domain: truncate(domain, BRAIN_TEACHING_MAX_IDENTIFIER_CHARS) }
      : {}),
    text: truncate(input.text.trim(), BRAIN_TEACHING_MAX_TEXT_CHARS),
    ...(contextThreadUrl
      ? {
          context_thread_url: truncate(
            contextThreadUrl,
            BRAIN_TEACHING_MAX_IDENTIFIER_CHARS,
          ),
        }
      : {}),
    ...(answersQuestionId ? { answers_question_id: answersQuestionId } : {}),
  };
}

export type PostBrainTeachingResult =
  | {
      kind: "accepted";
      teachingId: string;
      taskId: string | null;
      note: string | null;
    }
  | Exclude<PostBrainOpsResult, { kind: "accepted" }>;

/**
 * POST the teaching to the Brain ops API. 2xx with a teaching_id is
 * acceptance (task_id may be absent when the distill investigation could
 * not be dispatched immediately — still success). 4xx is validation
 * feedback to surface verbatim; 5xx / network errors / timeouts are
 * retryable ("couldn't reach the Brain").
 */
export async function postBrainTeaching(input: {
  teachingsUrl: string;
  token: string | null;
  headers?: Record<string, string>;
  payload: BrainTeachingPayload;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<PostBrainTeachingResult> {
  const result = await postBrainOps({
    url: input.teachingsUrl,
    idField: "teaching_id",
    token: input.token,
    headers: input.headers,
    payload: input.payload,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  if (result.kind !== "accepted") return result;
  return {
    kind: "accepted",
    teachingId: result.id,
    taskId: result.taskId,
    note: result.note,
  };
}
