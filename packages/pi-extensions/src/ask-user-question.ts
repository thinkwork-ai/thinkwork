/**
 * ask_user_question — structured HITL clarification tool (plan
 * 2026-06-09-005 U5).
 *
 * The parent agent asks the user 1–4 structured, optioned questions; the
 * batch is persisted through the platform intake endpoint
 * (POST /api/threads/{threadId}/questions, U2) which writes the question
 * card message and the pending_user_questions row in one transaction.
 * On success the tool returns the SENTINEL result:
 *
 *   - `details.thinkworkAskUserQuestion.endTurn === true` — the
 *     machine-readable flag the pi-runtime-core loop watches on
 *     `tool_execution_end` to end the turn deterministically, and
 *   - `terminate: true` — the Pi SDK's native early-termination hint
 *     (the agent loop stops after the tool batch when every result in
 *     the batch sets it), so a single-call batch ends cleanly with the
 *     turn still finalizing as a SUCCESS.
 *
 * Phantom-wait rule: the sentinel is returned ONLY when a pending row is
 * known to EXIST — intake-confirmed persistence (HTTP 200), or HTTP 409
 * (a batch persisted earlier is already pending, so the thread IS waiting
 * on the user and the turn must end deterministically; the 409 sentinel
 * additionally carries `alreadyPending: true`). Network/timeout/other
 * HTTP failures return a plain error-text result with NO endTurn flag and
 * NO terminate hint — the loop must never park a thread on a question
 * that was not stored. `execute` never throws.
 *
 * State: the only state is a turn-scoped guard closure. The host builds
 * a fresh extension instance per invocation (buildInvocationResources in
 * the cloud host), so the guard resets every turn — durable sessions on
 * warm containers can re-ask in later turns.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

/** Detail key the loop's sentinel detection matches on (keep in sync with
 *  `askUserQuestionEndTurn` in @thinkwork/pi-runtime-core agent-loop). */
export const ASK_USER_QUESTION_DETAIL_KEY = "thinkworkAskUserQuestion";

export interface AskUserQuestionToolConfig {
  apiUrl?: unknown;
  apiSecret?: unknown;
  threadId?: unknown;
  threadTurnId?: unknown;
  /** Explicit kill switch; default true. The tool also self-disables when
   *  any of the wiring fields above is missing. */
  enabled?: unknown;
}

export interface AskUserQuestionExtensionOptions {
  askUserQuestionConfig?: AskUserQuestionToolConfig | null;
  fetchImpl?: FetchLike;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return body
    ? `HTTP ${response.status}: ${body.slice(0, 500)}`
    : `HTTP ${response.status}`;
}

/** Plain error-text result. Deliberately carries NO endTurn flag and NO
 *  terminate hint (phantom-wait rule) and is returned, not thrown. */
function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${text}` }],
    details: { [ASK_USER_QUESTION_DETAIL_KEY]: { error: text } },
  };
}

const ALREADY_PENDING_MESSAGE =
  "a question is already pending for this thread — end your turn now; " +
  "the user's answer arrives in the next turn.";

/** Intake POST deadline; past this the question delivery is treated as a
 *  network failure (no sentinel — phantom-wait rule). */
const INTAKE_TIMEOUT_MS = 15_000;

const askUserQuestionParameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      question: Type.String({
        minLength: 1,
        description: "The full question text shown to the user.",
      }),
      header: Type.String({
        minLength: 1,
        maxLength: 12,
        description:
          'Very short topic label, max 12 characters (e.g. "Scope").',
      }),
      options: Type.Array(
        Type.Object({
          label: Type.String({
            minLength: 1,
            maxLength: 60,
            description:
              'Option label, max 60 characters. Append " (Recommended)" ' +
              "to exactly one option's label when you have a preferred answer.",
          }),
          description: Type.String({
            description:
              "One-line explanation of what choosing this option means.",
          }),
        }),
        {
          minItems: 2,
          maxItems: 4,
          description: "2-4 answer options for this question.",
        },
      ),
      multiSelect: Type.Optional(
        Type.Boolean({
          description: "True when the user may select more than one option.",
        }),
      ),
    }),
    {
      minItems: 1,
      maxItems: 4,
      description:
        "1-4 questions. Batch EVERY open question for this decision point " +
        "into one call — you only get one ask per turn.",
    },
  ),
  delegationContext: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description:
        "Internal escalation context (profile slug, original task, " +
        "escalation count). Set ONLY when relaying a specialist " +
        "needs_clarification handoff; omit for your own questions.",
    }),
  ),
});

export function createAskUserQuestionExtension(
  options: AskUserQuestionExtensionOptions,
): ThinkworkExtension {
  const config = options.askUserQuestionConfig;
  const apiUrl = asString(config?.apiUrl).replace(/\/+$/, "");
  const apiSecret = asString(config?.apiSecret);
  const threadId = asString(config?.threadId);
  const threadTurnId = asString(config?.threadTurnId);
  const enabled =
    config?.enabled !== false &&
    Boolean(apiUrl && apiSecret && threadId && threadTurnId);

  // Turn-scoped guard: the host rebuilds this closure every invocation
  // (buildInvocationResources), so "this turn" === the lifetime of this
  // extension instance. NEVER lift this to module/session scope — durable
  // sessions on warm containers would wedge legitimate re-asks.
  let askedThisTurn = false;

  return defineExtension({
    name: "thinkwork-ask-user-question",
    toolNames: enabled ? [ASK_USER_QUESTION_TOOL_NAME] : [],
    register(pi) {
      if (!enabled) return;
      const fetchImpl = options.fetchImpl ?? fetch;

      const tool: ToolDefinition = {
        name: ASK_USER_QUESTION_TOOL_NAME,
        label: "Ask User Question",
        description:
          "Ask the user structured clarifying questions and END YOUR TURN. " +
          "Use only when ambiguity genuinely changes the outcome and the " +
          "answer is not in context, the workspace, or memory. Batch every " +
          "open question for the decision point into ONE call (max 4 " +
          "questions). Each question needs: a short header (max 12 chars), " +
          "the question text, and 2-4 options ({label, description}); append " +
          '" (Recommended)" to exactly one option label per question when ' +
          "you have a preferred answer; set multiSelect: true when several " +
          "options can be combined. After this tool succeeds the turn ends " +
          "immediately — do NOT keep working or do the work anyway; the " +
          "user's answer arrives at the start of your next turn.",
        parameters: askUserQuestionParameters,
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          if (askedThisTurn) {
            // Short-circuit WITHOUT posting — one ask per turn.
            return errorResult(ALREADY_PENDING_MESSAGE);
          }

          const typed = asRecord(params);
          const questions = Array.isArray(typed.questions)
            ? typed.questions
            : [];
          if (questions.length === 0) {
            return errorResult(
              "ask_user_question requires a non-empty questions array.",
            );
          }
          const delegationContext = asRecord(typed.delegationContext);

          const timeoutController = new AbortController();
          const timeoutHandle = setTimeout(
            () => timeoutController.abort(),
            INTAKE_TIMEOUT_MS,
          );
          let response: Response;
          try {
            response = await fetchImpl(
              `${apiUrl}/api/threads/${threadId}/questions`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiSecret}`,
                  "Content-Type": "application/json",
                  "User-Agent": "Thinkwork-AgentCore-Pi/1.0",
                },
                body: JSON.stringify({
                  thread_turn_id: threadTurnId,
                  questions,
                  delegation_context:
                    Object.keys(delegationContext).length > 0
                      ? delegationContext
                      : null,
                }),
                signal: timeoutController.signal,
              },
            );
          } catch (err) {
            // Network failure / timeout — the question was NOT delivered,
            // so the turn must not park (phantom-wait rule). No sentinel.
            const detail = timeoutController.signal.aborted
              ? `request timed out after ${INTAKE_TIMEOUT_MS}ms`
              : err instanceof Error
                ? err.message
                : String(err);
            return errorResult(
              `ask_user_question could not reach the platform (${detail}). ` +
                "The question was NOT delivered. Proceed on your best " +
                "judgment, or ask the user in prose if the answer is " +
                "essential.",
            );
          } finally {
            clearTimeout(timeoutHandle);
          }

          if (response.status === 409) {
            // A batch is already pending (persisted by an earlier turn or
            // a racing path) — the thread IS waiting on the user. This
            // call persisted nothing, but the pending row EXISTS, so the
            // turn must still end deterministically: return the sentinel
            // (flagged alreadyPending) with the instructive error text.
            askedThisTurn = true;
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: ${ALREADY_PENDING_MESSAGE}`,
                },
              ],
              details: {
                [ASK_USER_QUESTION_DETAIL_KEY]: {
                  endTurn: true,
                  alreadyPending: true,
                },
              },
              terminate: true,
            };
          }

          if (!response.ok) {
            return errorResult(
              `ask_user_question failed (${await readError(response)}). ` +
                "The question was NOT delivered. Proceed on your best " +
                "judgment, or ask the user in prose if the answer is " +
                "essential.",
            );
          }

          const body = asRecord(await response.json().catch(() => ({})));
          askedThisTurn = true;
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "Question posted to the user. The turn ends now; their " +
                  "answer arrives in the next turn.",
              },
            ],
            details: {
              [ASK_USER_QUESTION_DETAIL_KEY]: {
                ...(asString(body.questionId)
                  ? { questionId: asString(body.questionId) }
                  : {}),
                endTurn: true,
              },
            },
            // Native SDK early-termination hint: when every tool result in
            // the batch sets this, the agent loop stops after the batch and
            // the turn finalizes normally (success). The loop-side sentinel
            // detection is the backstop for mixed parallel batches.
            terminate: true,
          };
        },
      };

      pi.registerTool(tool);
    },
  });
}
