/**
 * Interactive answer forms: the machine-readable `answers` fence a worker
 * appends to its `blocker:` comment, and the Block Kit blocks the escalation
 * renders from it (option buttons + an "Other…" escape hatch).
 *
 * Two halves, both pure and unit-testable:
 *   - parseAnswerForm  — extract the LAST ```answers fenced YAML block from a
 *     comment body. Tolerant by construction, exactly like the ledger parser
 *     (src/linear/ledger.ts learned live that a malformed fence must degrade
 *     gracefully, never throw): missing fence / invalid YAML / a fully
 *     malformed list → null; a partly-valid list keeps its valid entries.
 *   - buildQuestionBlocks / buildRetryBlocks — Slack blocks for the two
 *     escalation shapes (worker question with options vs a daemon
 *     `factory-block:` ceiling with nothing to choose from).
 *
 * Slack hard limits baked in here (exceeding any of them makes chat.postMessage
 * reject the WHOLE message, so the escalation would silently not post):
 *   - button `plain_text` label: 75 chars
 *   - button `value`: 2000 chars
 *   - section `text`: 3000 chars
 */

import { parse as parseYaml } from "yaml";
import {
  BUTTON_LABEL_MAX,
  SECTION_TEXT_MAX,
  VALUE_ANSWER_MAX,
} from "./blocks.js";

export interface AnswerFormQuestion {
  question: string;
  /** Full option labels — NOT truncated; the relayed answer uses these. */
  options: string[];
  /** 0-based index of the recommended option, or null when absent/invalid. */
  recommended: number | null;
}

export interface AnswerForm {
  questions: AnswerFormQuestion[];
}

const FENCE_OPEN = "```answers";
const FENCE_CLOSE = "```";

// Slack hard limits live in blocks.ts (KTD7) — one source of truth. The
// incident context (a limit breach makes chat.postMessage reject the WHOLE
// message, so the escalation silently never posts) is documented there.

/** Action id prefix shared by every answer-form button (the gateway filters on it). */
export const ANSWER_ACTION_PREFIX = "factory-answer";
export const OTHER_ACTION_ID = "factory-answer-other";
export const RETRY_ACTION_ID = "factory-answer-retry";

/**
 * Parse the machine-readable answer form out of a worker's `blocker:` comment.
 * The LAST ```answers fence wins (mirrors "newest baton wins" — a worker that
 * revises its questions appends, it does not edit). Returns null when there is
 * nothing parseable; malformed entries are dropped individually so one bad
 * list item does not cost the operator the whole form. NEVER throws — a
 * garbled fence must degrade to the plain-text escalation, not kill the tick.
 */
export function parseAnswerForm(body: string): AnswerForm | null {
  const lines = body.split("\n");
  // Find the LAST answers fence.
  let openIdx = -1;
  let closeIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== FENCE_OPEN) continue;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === FENCE_CLOSE) {
        close = j;
        break;
      }
    }
    if (close !== -1) {
      openIdx = i;
      closeIdx = close;
      break;
    }
  }
  if (openIdx === -1 || closeIdx === -1) return null;

  let parsed: unknown;
  try {
    parsed = parseYaml(lines.slice(openIdx + 1, closeIdx).join("\n"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const questions: AnswerFormQuestion[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.question !== "string" || e.question.trim() === "") continue;
    if (!Array.isArray(e.options)) continue;
    const options = e.options.filter(
      (o): o is string => typeof o === "string" && o.trim() !== "",
    );
    if (options.length === 0) continue;
    // `recommended` is 1-based in the fence (matches the numbered-question
    // prose); normalize to 0-based here. Out-of-range → null, keep the entry.
    let recommended: number | null = null;
    if (
      typeof e.recommended === "number" &&
      Number.isInteger(e.recommended) &&
      e.recommended >= 1 &&
      e.recommended <= options.length
    ) {
      recommended = e.recommended - 1;
    }
    questions.push({ question: e.question.trim(), options, recommended });
  }
  if (questions.length === 0) return null;
  return { questions };
}

/** JSON payload carried in every answer button's `value`. */
export interface AnswerButtonValue {
  /** The escalation idempotency key (question comment id) this form answers. */
  key: string;
  /** Question index (0-based). */
  q?: number;
  /** Option index (0-based). */
  o?: number;
  /** The full relayed answer text, e.g. "Q1: Read-only (drive.readonly)". */
  answer?: string;
}

function truncate(text: string, max: number, suffix = "…"): string {
  if (text.length <= max) return text;
  return text.slice(0, max - suffix.length) + suffix;
}

/**
 * The escalation body as a section block, truncated to Slack's 3000-char
 * section limit. When cut, a pointer note replaces the tail — the full
 * question always lives in Linear, so nothing is lost, only elided.
 */
function bodySection(bodyText: string): Record<string, unknown> {
  let text = bodyText;
  if (text.length > SECTION_TEXT_MAX) {
    text =
      text.slice(0, SECTION_TEXT_MAX) +
      "\n_(truncated — full question in Linear)_";
  }
  return { type: "section", text: { type: "mrkdwn", text } };
}

function otherButton(escalationKey: string): Record<string, unknown> {
  return {
    type: "button",
    action_id: OTHER_ACTION_ID,
    text: { type: "plain_text", text: "✍️ Other…", emoji: true },
    value: JSON.stringify({ key: escalationKey } satisfies AnswerButtonValue),
  };
}

/**
 * Blocks for a worker question WITH a parseable answer form: the escalation
 * text, then per question a `*Q<n>.*` section followed by one button per
 * option. The recommended option is styled `primary` with a ✅ prefix. A final
 * actions block carries the "Other…" escape hatch (type a free-form answer in
 * the thread — the existing text relay).
 *
 * `identifier` is currently only load-bearing for legibility in the relayed
 * answer text; keys/indices in the value JSON do the routing.
 */
export function buildQuestionBlocks(
  identifier: string,
  escalationKey: string,
  form: AnswerForm,
  bodyText: string,
): unknown[] {
  void identifier;
  const blocks: unknown[] = [bodySection(bodyText)];
  form.questions.forEach((q, qIdx) => {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncate(`*Q${qIdx + 1}.* ${q.question}`, SECTION_TEXT_MAX),
      },
    });
    const buttons = q.options.map((option, oIdx) => {
      const isRecommended = q.recommended === oIdx;
      // Button labels cap at 75 chars (Slack rejects longer) — the FULL label
      // still rides in `value.answer`, so the relayed answer is never cut to
      // the button width.
      const label = truncate(
        isRecommended ? `✅ ${option}` : option,
        BUTTON_LABEL_MAX,
      );
      const value: AnswerButtonValue = {
        key: escalationKey,
        q: qIdx,
        o: oIdx,
        answer: `Q${qIdx + 1}: ${truncate(option, VALUE_ANSWER_MAX)}`,
      };
      return {
        type: "button",
        // Unique per message: one action_id per (question, option) pair.
        action_id: `${ANSWER_ACTION_PREFIX}:${qIdx}:${oIdx}`,
        text: { type: "plain_text", text: label, emoji: true },
        value: JSON.stringify(value),
        ...(isRecommended ? { style: "primary" } : {}),
      };
    });
    blocks.push({ type: "actions", elements: buttons });
  });
  blocks.push({ type: "actions", elements: [otherButton(escalationKey)] });
  return blocks;
}

/**
 * Blocks for an escalation with NO parseable form — typically a daemon
 * `factory-block:` ceiling (consecutive failed attempts), where the only
 * one-click action that makes sense is "clear the blocker and let it retry".
 */
export function buildRetryBlocks(
  identifier: string,
  escalationKey: string,
  bodyText: string,
): unknown[] {
  void identifier;
  return [
    bodySection(bodyText),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: RETRY_ACTION_ID,
          text: { type: "plain_text", text: "🔁 Clear blocker & retry", emoji: true },
          value: JSON.stringify({
            key: escalationKey,
          } satisfies AnswerButtonValue),
          style: "primary",
        },
        otherButton(escalationKey),
      ],
    },
  ];
}
