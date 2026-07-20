/**
 * Answer-intake consent recording for mapping-candidate questions
 * (THINK-321 U6, KTD-2's load-bearing piece).
 *
 * When the agent presents mapping candidates via ask_user_question, the
 * question carries `candidateSetId` and each option carries `candidateId`
 * (the "None of these" option carries {@link NONE_OF_THESE_CANDIDATE_ID}).
 * At CARD answer intake — server-side, BEFORE the resumed turn runs — the
 * selected option's candidate id is recorded on the candidate set via
 * `recordCandidateSelection`, so `confirm_mapping` (and the decline path)
 * can enforce the echo check against what the user actually picked.
 *
 * Fail-closed by construction: forged or malformed metadata records
 * nothing (the routing lib refuses unless the set exists for the tenant,
 * is open and unexpired, belongs to the answering thread, and — for a real
 * selection — contains the candidate id), and a refused/failed recording
 * never breaks the answer: the downstream confirm simply refuses with
 * `no_selection_recorded`.
 */

import type { IdentityDbClient } from "./matcher.js";
import {
  DECLINED_CANDIDATE_MARKER,
  recordCandidateSelection,
} from "./routing.js";

const LOG_PREFIX = "[candidate-consent]";

/**
 * The candidateId the agent is instructed to put on the mandatory
 * "None of these" option. Maps to {@link DECLINED_CANDIDATE_MARKER} when
 * recorded. Keep in sync with the identity-resolution extension guidance
 * (packages/pi-extensions/src/identity-resolution.ts).
 */
export const NONE_OF_THESE_CANDIDATE_ID = "none";

/** Conservative id charset — candidate ids are 16 hex chars, set ids are
 *  UUIDs, and the none sentinel is alphanumeric. Anything else is treated
 *  as forged/malformed metadata and ignored. */
export const CANDIDATE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface ExtractedCandidateSelection {
  candidateSetId: string;
  /** A real candidate id, or DECLINED_CANDIDATE_MARKER for "None of these". */
  candidateId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asId(value: unknown): string | null {
  return typeof value === "string" && CANDIDATE_ID_RE.test(value)
    ? value
    : null;
}

/** Normalize an option label for selected-answer matching (mirrors the
 *  runtime's user-question-context matching: trim, drop the
 *  " (Recommended)" suffix, case-insensitive). */
function normalizeLabel(label: string): string {
  return label
    .trim()
    .replace(/\s*\(recommended\)\s*$/i, "")
    .toLowerCase();
}

/** Find this question's answer value in the card answers record — keyed by
 *  header first, then question text, then batch index (the same lookup the
 *  runtime uses to echo answers). */
function answerForQuestion(
  answers: Record<string, unknown>,
  question: { header: string; question: string },
  index: number,
  consumedKeys: Set<string>,
): unknown {
  const byKey = new Map<string, string>();
  for (const key of Object.keys(answers)) {
    byKey.set(key.trim().toLowerCase(), key);
  }
  const lookups = [
    question.header.trim().toLowerCase(),
    question.question.trim().toLowerCase(),
    String(index),
  ];
  for (const lookup of lookups) {
    if (!lookup) continue;
    const key = byKey.get(lookup);
    if (key !== undefined && !consumedKeys.has(key)) {
      consumedKeys.add(key);
      return answers[key];
    }
  }
  return undefined;
}

/**
 * Pure extraction: map a question batch + structured card answers to the
 * candidate selections to record. Non-candidate questions (no
 * `candidateSetId`) yield nothing. A selection is extracted only when the
 * answer matches EXACTLY ONE option that carries a well-formed candidate
 * id — free-text answers, multi-picks, and forged ids extract nothing
 * (fail closed; the confirm then refuses with no_selection_recorded).
 */
export function extractCandidateSelections(
  questions: unknown,
  answers: unknown,
): ExtractedCandidateSelection[] {
  if (!Array.isArray(questions) || !isRecord(answers)) return [];
  const selections: ExtractedCandidateSelection[] = [];
  const consumedKeys = new Set<string>();
  questions.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const candidateSetId = asId(raw.candidateSetId);
    const header = typeof raw.header === "string" ? raw.header : "";
    const questionText = typeof raw.question === "string" ? raw.question : "";
    const value = answerForQuestion(
      answers,
      { header, question: questionText },
      index,
      consumedKeys,
    );
    if (!candidateSetId) return;
    if (!Array.isArray(raw.options)) return;
    const values = Array.isArray(value) ? value : [value];
    const picked = values.filter(
      (entry): entry is string => typeof entry === "string",
    );
    if (picked.length !== 1) return;
    const normalized = normalizeLabel(picked[0]!);
    if (!normalized) return;
    const matchedOptions = raw.options.filter(
      (option) =>
        isRecord(option) &&
        typeof option.label === "string" &&
        normalizeLabel(option.label) === normalized,
    ) as Array<Record<string, unknown>>;
    if (matchedOptions.length !== 1) return;
    const candidateId = asId(matchedOptions[0]!.candidateId);
    if (!candidateId) return;
    selections.push({
      candidateSetId,
      candidateId:
        candidateId === NONE_OF_THESE_CANDIDATE_ID
          ? DECLINED_CANDIDATE_MARKER
          : candidateId,
    });
  });
  return selections;
}

export interface RecordCandidateSelectionsResult {
  recorded: number;
  refused: number;
}

/**
 * Record every extracted candidate selection for a CARD-answered question
 * batch. Best-effort and never throws: a refused or failed recording is
 * logged and skipped — consent then fails closed downstream (the resumed
 * turn's confirm/decline refuses). Makes NO db calls when the batch has no
 * candidate questions.
 */
export async function recordCandidateSelectionsFromAnswers(
  db: IdentityDbClient,
  args: {
    tenantId: string;
    threadId: string;
    questions: unknown;
    answers: unknown;
    now?: Date;
  },
): Promise<RecordCandidateSelectionsResult> {
  const selections = extractCandidateSelections(args.questions, args.answers);
  let recorded = 0;
  let refused = 0;
  for (const selection of selections) {
    try {
      const result = await recordCandidateSelection(db, {
        tenantId: args.tenantId,
        threadRef: args.threadId,
        candidateSetId: selection.candidateSetId,
        candidateId: selection.candidateId,
        now: args.now,
      });
      if (result.status === "recorded") {
        recorded += 1;
      } else {
        refused += 1;
        console.error(
          `${LOG_PREFIX} selection refused (${result.reason}) set=${selection.candidateSetId} thread=${args.threadId}`,
        );
      }
    } catch (err) {
      refused += 1;
      console.error(
        `${LOG_PREFIX} selection recording failed set=${selection.candidateSetId} thread=${args.threadId}:`,
        err,
      );
    }
  }
  return { recorded, refused };
}
