/**
 * Question-message helpers for the ask_user_question HITL intake
 * (plan 2026-06-09-005 U2).
 *
 * The question message is written ONCE at intake time:
 *   - `content`  = readable markdown rendering of the batch — the text
 *     fallback for mobile/connector surfaces that don't render parts (R16).
 *   - `parts`    = [{ type: "data-user-question", questionId, questions }]
 *     — the questions payload only, NEVER answer state. Answered state is
 *     derived from the pending_user_questions row (one writer, one source
 *     of truth); parts are never mutated in place.
 *
 * Part-builder shape follows packages/api/src/lib/task-queues/message-parts.ts.
 */

export const MAX_QUESTIONS_PER_BATCH = 4;
export const MIN_OPTIONS_PER_QUESTION = 2;
export const MAX_OPTIONS_PER_QUESTION = 4;
export const MAX_HEADER_CHARS = 12;
export const MAX_LABEL_CHARS = 60;
/** Cap on the serialized questions + delegation_context payload. */
export const MAX_PAYLOAD_BYTES = 8 * 1024;

/** Charset for mapping-candidate metadata ids (THINK-321 U6): candidate
 *  ids are 16 hex chars, set ids are UUIDs, the none sentinel is
 *  alphanumeric. Anything else is rejected at intake. */
export const CANDIDATE_METADATA_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface UserQuestionOption {
  label: string;
  description: string;
  /** Mapping-candidate metadata (THINK-321 U6): the candidate id this
   *  option stands for (or "none" on the "None of these" option). Only
   *  meaningful on questions carrying `candidateSetId`. */
  candidateId?: string;
}

export interface UserQuestionInput {
  question: string;
  header: string;
  options: UserQuestionOption[];
  multiSelect?: boolean;
  /** Mapping-candidate metadata (THINK-321 U6): the candidate set id from
   *  propose_mapping_candidates when this question presents mapping
   *  candidates. Answer intake records the selected option's candidateId
   *  against this set (KTD-2 consent recording). */
  candidateSetId?: string;
}

export interface UserQuestionPart {
  type: "data-user-question";
  questionId: string;
  questions: UserQuestionInput[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate a question batch against the tool contract. Returns a
 * human-readable reason on failure, or null when the batch is valid.
 *
 * Contract: 1–4 questions; each has a non-empty `question`, a non-empty
 * `header` ≤ 12 chars UNIQUE within the batch (case-insensitive — card
 * answers are keyed by header), 2–4 options each { label: non-empty
 * ≤ 60 chars, description: string }, optional `multiSelect` boolean;
 * optional `delegation_context` plain object; serialized payload ≤ 8 KB
 * total.
 */
export function validateQuestionBatch(
  questions: unknown,
  delegationContext: unknown,
): string | null {
  if (!Array.isArray(questions) || questions.length === 0) {
    return "questions must be a non-empty array";
  }
  if (questions.length > MAX_QUESTIONS_PER_BATCH) {
    return `too many questions in one batch (max ${MAX_QUESTIONS_PER_BATCH})`;
  }
  const seenHeaders = new Set<string>();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!isRecord(q)) return `questions[${i}] must be an object`;
    if (typeof q.question !== "string" || q.question.trim() === "") {
      return `questions[${i}].question must be a non-empty string`;
    }
    if (typeof q.header !== "string" || q.header.trim() === "") {
      return `questions[${i}].header must be a non-empty string`;
    }
    if (q.header.length > MAX_HEADER_CHARS) {
      return `questions[${i}].header exceeds ${MAX_HEADER_CHARS} characters`;
    }
    // Card answers are keyed by header — a duplicate header makes two
    // questions indistinguishable in the answers payload.
    const headerKey = q.header.trim().toLowerCase();
    if (seenHeaders.has(headerKey)) {
      return `questions[${i}].header duplicates an earlier question header (headers must be unique, case-insensitive)`;
    }
    seenHeaders.add(headerKey);
    if (!Array.isArray(q.options)) {
      return `questions[${i}].options must be an array`;
    }
    if (
      q.options.length < MIN_OPTIONS_PER_QUESTION ||
      q.options.length > MAX_OPTIONS_PER_QUESTION
    ) {
      return `questions[${i}].options must have ${MIN_OPTIONS_PER_QUESTION}-${MAX_OPTIONS_PER_QUESTION} items`;
    }
    const isCandidateQuestion = q.candidateSetId !== undefined;
    if (isCandidateQuestion) {
      if (
        typeof q.candidateSetId !== "string" ||
        !CANDIDATE_METADATA_ID_RE.test(q.candidateSetId)
      ) {
        return `questions[${i}].candidateSetId must match ${CANDIDATE_METADATA_ID_RE}`;
      }
      // Consent recording needs exactly one selection per candidate set.
      if (q.multiSelect === true) {
        return `questions[${i}] carries candidateSetId and must not be multiSelect`;
      }
    }
    for (let j = 0; j < q.options.length; j++) {
      const opt: unknown = q.options[j];
      if (!isRecord(opt))
        return `questions[${i}].options[${j}] must be an object`;
      if (typeof opt.label !== "string" || opt.label.trim() === "") {
        return `questions[${i}].options[${j}].label must be a non-empty string`;
      }
      if (opt.label.length > MAX_LABEL_CHARS) {
        return `questions[${i}].options[${j}].label exceeds ${MAX_LABEL_CHARS} characters`;
      }
      if (typeof opt.description !== "string") {
        return `questions[${i}].options[${j}].description must be a string`;
      }
      if (opt.candidateId !== undefined) {
        if (!isCandidateQuestion) {
          return `questions[${i}].options[${j}].candidateId requires questions[${i}].candidateSetId`;
        }
        if (
          typeof opt.candidateId !== "string" ||
          !CANDIDATE_METADATA_ID_RE.test(opt.candidateId)
        ) {
          return `questions[${i}].options[${j}].candidateId must match ${CANDIDATE_METADATA_ID_RE}`;
        }
      }
    }
    if (q.multiSelect !== undefined && typeof q.multiSelect !== "boolean") {
      return `questions[${i}].multiSelect must be a boolean`;
    }
  }
  if (delegationContext !== undefined && delegationContext !== null) {
    if (!isRecord(delegationContext)) {
      return "delegation_context must be an object";
    }
  }
  const serialized = JSON.stringify({
    questions,
    delegation_context: delegationContext ?? null,
  });
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    return `serialized question payload exceeds ${MAX_PAYLOAD_BYTES} bytes`;
  }
  return null;
}

/**
 * Readable markdown rendering of the batch — each question with its options
 * as a bulleted list. This is the text fallback for surfaces that don't
 * render the structured part (mobile/connectors, R16).
 */
export function renderQuestionMarkdown(questions: UserQuestionInput[]): string {
  return questions
    .map((q) => {
      const lines: string[] = [];
      lines.push(`**${q.header.trim()}**`);
      lines.push("");
      lines.push(
        q.multiSelect
          ? `${q.question.trim()} _(select all that apply)_`
          : q.question.trim(),
      );
      lines.push("");
      for (const opt of q.options) {
        const description = opt.description.trim();
        lines.push(
          description
            ? `- ${opt.label.trim()} — ${description}`
            : `- ${opt.label.trim()}`,
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Injection boundary for mapping-candidate questions (THINK-321 U6):
 * candidate option labels/descriptions are derived from EXTERNAL source
 * records, so at the point they enter the question payload they get the
 * same treatment the U5 extension applies to tool results (see
 * `sanitizeExternalLabel` in packages/pi-extensions/src/
 * identity-resolution.ts — keep in sync): control characters stripped,
 * delimiter forgery (`<external_record>`, `<user_answer>`) neutralized,
 * whitespace collapsed.
 */
export function sanitizeCandidateQuestionText(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/<\/?external_record>/gi, "")
      .replace(/<\/?user_answer>/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Sanitize every question that carries candidate metadata (candidateSetId)
 * before persisting the batch — the external-record-derived strings must
 * never reach the question card or the resumed-turn echo unsanitized.
 * Non-candidate questions pass through untouched (agent-authored text).
 */
export function sanitizeCandidateQuestions(
  questions: UserQuestionInput[],
): UserQuestionInput[] {
  return questions.map((question) => {
    if (question.candidateSetId === undefined) return question;
    return {
      ...question,
      question: sanitizeCandidateQuestionText(question.question),
      options: question.options.map((option) => ({
        ...option,
        label: sanitizeCandidateQuestionText(option.label),
        description: sanitizeCandidateQuestionText(option.description),
      })),
    };
  });
}

/**
 * Structured UIMessage part carrying the question batch. Questions payload
 * only — answer state is resolved from pending_user_questions, never here.
 */
export function userQuestionPart(
  questionId: string,
  questions: UserQuestionInput[],
): UserQuestionPart {
  return {
    type: "data-user-question",
    questionId,
    questions,
  };
}
