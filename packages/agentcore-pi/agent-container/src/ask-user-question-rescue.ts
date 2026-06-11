/**
 * Leaked-tool-call rescue for ask_user_question.
 *
 * Kimi K2.5 via Bedrock intermittently emits its tool calls as TEXT instead
 * of native tool-use blocks. Two observed leak formats in assistant content:
 *
 *   A) `<tool_call>` (possibly repeated) followed by the well-formed call
 *      JSON: `{"tool": "ask_user_question", "arguments": {"questions": [...]}}`,
 *      possibly with trailing prose after the JSON.
 *
 *   B) Kimi special tokens:
 *      `functions.ask_user_question:1 <|tool_call_argument_begin|>
 *       {"questions": [...]} <|tool_call_end|> <|tool_calls_section_end|>
 *       [blocked]`
 *      — the JSON between argument_begin and tool_call_end is usually
 *      well-formed. There is also a mangled variant with shortened keys
 *      ("q"/"l"/"d"/"mS") that is NOT reliably parseable.
 *
 * The rescue detects the leak in the parent turn's final assistant content,
 * extracts the questions payload when parseable, re-posts it through the
 * same intake endpoint the ask_user_question extension uses
 * (POST {apiUrl}/api/threads/{threadId}/questions — the intake writes the
 * question-card message itself), and strips the raw token soup from the
 * persisted content. When the payload can't be parsed (or posting is
 * disabled — eval mode / turn already asked), the syntax is stripped only.
 * When the post fails, a readable markdown rendering of the parsed
 * questions is appended so the user at least sees clean questions.
 *
 * Detection is ask_user_question-specific by design: a `<tool_call>` leak
 * for a DIFFERENT tool must pass through untouched — this module never eats
 * other tools' leaks.
 */

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

/** Detail key the ask_user_question extension's sentinel rides under (keep
 *  in sync with ASK_USER_QUESTION_DETAIL_KEY in @thinkwork/pi-extensions). */
const ASK_USER_QUESTION_DETAIL_KEY = "thinkworkAskUserQuestion";

const TOOL_CALL_TOKEN = "<tool_call>";
const ARGUMENT_BEGIN_TOKEN = "<|tool_call_argument_begin|>";
const FUNCTIONS_MARKER = "functions.ask_user_question";

/** Kimi trailer tokens consumed (with interleaved whitespace) after the
 *  matched JSON when stripping a leak block. */
const TRAILER_TOKENS = [
  "<|tool_call_end|>",
  "<|tool_calls_section_end|>",
  "[blocked]",
];

/** Contract limits — mirror validateQuestionBatch in
 *  packages/api/src/lib/user-questions/question-message.ts. */
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_HEADER_CHARS = 12;
const MAX_LABEL_CHARS = 60;

export interface RescuedQuestionOption {
  label: string;
  description: string;
}

export interface RescuedQuestion {
  header: string;
  question: string;
  options: RescuedQuestionOption[];
  multiSelect?: boolean;
}

export type RescuePostOutcome =
  | { ok: true; questionId?: string }
  | { ok: false; status?: number };

export type RescuePost = (
  questions: RescuedQuestion[],
) => Promise<RescuePostOutcome>;

export interface RescueResult {
  /** Final assistant content — leak syntax stripped; on post failure the
   *  parsed questions are appended as readable markdown. */
  content: string;
  /** True only when the intake POST persisted the question batch. */
  rescued: boolean;
  questionId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Leak-block scanning.
// ---------------------------------------------------------------------------

interface BalancedJson {
  start: number;
  /** Index AFTER the closing brace. */
  end: number;
  raw: string;
}

/** String-aware balanced-brace scan for the first `{...}` object at or after
 *  `from`. Returns null when no balanced object completes. */
function extractBalancedJson(text: string, from: number): BalancedJson | null {
  const start = text.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { start, end: i + 1, raw: text.slice(start, i + 1) };
      }
    }
  }
  return null;
}

interface LeakBlock {
  /** Index of the first marker character. */
  start: number;
  /** Index AFTER the block (matched JSON + trailer tokens), or text.length
   *  when no parseable JSON follows (mangled leak — strip to end). */
  end: number;
  /** Parsed JSON payload when a balanced + parseable object was matched. */
  payload: unknown | undefined;
}

/** Consume whitespace + Kimi trailer tokens after `from`. */
function consumeTrailers(text: string, from: number): number {
  let i = from;
  for (;;) {
    let advanced = false;
    while (i < text.length && /\s/.test(text[i]!)) i++;
    for (const token of TRAILER_TOKENS) {
      if (text.startsWith(token, i)) {
        i += token.length;
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return i;
}

/** Expand backward over a run of `<tool_call>` tokens (and the whitespace
 *  between them) that immediately precedes `index`. */
function expandToolCallRunStart(text: string, index: number): number {
  let start = index;
  for (;;) {
    let i = start - 1;
    while (i >= 0 && /\s/.test(text[i]!)) i--;
    const candidate = i - TOOL_CALL_TOKEN.length + 1;
    if (candidate >= 0 && text.startsWith(TOOL_CALL_TOKEN, candidate)) {
      start = candidate;
    } else {
      break;
    }
  }
  return start;
}

/**
 * Locate the first leaked ask_user_question block at or after `from`.
 * `<tool_call>` runs whose following JSON does not mention
 * ask_user_question are skipped (other tools' leaks stay untouched).
 */
function findFirstLeakBlock(text: string, from = 0): LeakBlock | null {
  const candidates: Array<{ marker: number; jsonFrom: number }> = [];

  const fnIdx = text.indexOf(FUNCTIONS_MARKER, from);
  if (fnIdx !== -1) {
    candidates.push({
      marker: fnIdx,
      jsonFrom: fnIdx + FUNCTIONS_MARKER.length,
    });
  }

  // <tool_call> runs — only ask-related ones qualify.
  let searchFrom = from;
  for (;;) {
    const tcIdx = text.indexOf(TOOL_CALL_TOKEN, searchFrom);
    if (tcIdx === -1) break;
    const json = extractBalancedJson(text, tcIdx + TOOL_CALL_TOKEN.length);
    const probe = json
      ? json.raw
      : text.slice(tcIdx, tcIdx + 400 + TOOL_CALL_TOKEN.length);
    if (probe.includes(ASK_USER_QUESTION_TOOL_NAME)) {
      candidates.push({
        marker: expandToolCallRunStart(text, tcIdx),
        jsonFrom: tcIdx + TOOL_CALL_TOKEN.length,
      });
      break;
    }
    searchFrom = json ? json.end : tcIdx + TOOL_CALL_TOKEN.length;
  }

  // Standalone argument_begin token near a "questions" payload.
  const abIdx = text.indexOf(ARGUMENT_BEGIN_TOKEN, from);
  if (abIdx !== -1 && text.slice(abIdx).includes('"questions"')) {
    candidates.push({
      marker: abIdx,
      jsonFrom: abIdx + ARGUMENT_BEGIN_TOKEN.length,
    });
  }

  // Bare `"tool"/"name": "ask_user_question"` JSON without any wrapper
  // token — block starts at the outermost enclosing object brace.
  const keyMatch = /"(?:tool|name)"\s*:\s*"ask_user_question"/.exec(
    text.slice(from),
  );
  if (keyMatch) {
    const keyIdx = from + keyMatch.index;
    let objStart = -1;
    for (let i = keyIdx; i >= from; i--) {
      if (text[i] !== "{") continue;
      const json = extractBalancedJson(text, i);
      if (json && json.end > keyIdx) objStart = i; // keep outermost
    }
    if (objStart !== -1) {
      candidates.push({ marker: objStart, jsonFrom: objStart });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.marker - b.marker);
  const { marker, jsonFrom } = candidates[0]!;

  // Match the first balanced JSON object after the marker that actually
  // PARSES. Brace-soup blobs that balance but don't parse (the mangled
  // `{{<tool>}}` variant) are skipped by advancing one character past their
  // opening brace so any nested object gets a chance.
  let scanFrom = jsonFrom;
  for (let guard = 0; guard < 16; guard++) {
    const json = extractBalancedJson(text, scanFrom);
    if (!json) break;
    try {
      const payload: unknown = JSON.parse(json.raw);
      return {
        start: marker,
        end: consumeTrailers(text, json.end),
        payload,
      };
    } catch {
      scanFrom = json.start + 1;
    }
  }
  // Mangled leak — no parseable JSON follows; strip through end of text.
  return { start: marker, end: text.length, payload: undefined };
}

// ---------------------------------------------------------------------------
// Public surface.
// ---------------------------------------------------------------------------

/** True when `text` contains leaked ask_user_question tool-call syntax. */
export function detectLeakedAskUserQuestion(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  if (text.includes(FUNCTIONS_MARKER)) return true;
  if (/"(?:tool|name)"\s*:\s*"ask_user_question"/.test(text)) return true;
  if (
    text.includes(ARGUMENT_BEGIN_TOKEN) &&
    text.slice(text.indexOf(ARGUMENT_BEGIN_TOKEN)).includes('"questions"')
  ) {
    return true;
  }
  return findFirstLeakBlock(text) !== null;
}

/** Unwrap `{tool, arguments:{questions}}` / `{arguments:{questions}}` /
 *  bare `{questions}` to the raw questions array. */
function unwrapQuestionsArray(value: unknown): unknown[] | null {
  if (!isRecord(value)) return null;
  if (Array.isArray(value.questions)) return value.questions;
  const args = value.arguments;
  if (isRecord(args) && Array.isArray(args.questions)) return args.questions;
  return null;
}

/**
 * Normalize + validate a candidate questions array against the intake
 * contract. Oversized headers/labels are TRUNCATED (the model already chose
 * them), extra options beyond 4 are dropped, questions with fewer than 2
 * valid options are dropped, duplicate headers (intake rejects them) are
 * dropped. Mangled short-key items ("q"/"l"/"d") fail the canonical-key
 * checks and drop out. Returns null when 0 valid questions remain.
 */
function normalizeQuestions(value: unknown): RescuedQuestion[] | null {
  const raw = unwrapQuestionsArray(value);
  if (!raw || raw.length === 0) return null;
  const out: RescuedQuestion[] = [];
  const seenHeaders = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_QUESTIONS) break;
    if (!isRecord(item)) continue;
    const question =
      typeof item.question === "string" ? item.question.trim() : "";
    if (!question) continue;
    const headerRaw = typeof item.header === "string" ? item.header.trim() : "";
    const header = headerRaw.slice(0, MAX_HEADER_CHARS).trim();
    if (!header) continue;
    const headerKey = header.toLowerCase();
    if (seenHeaders.has(headerKey)) continue;
    const optionsRaw = Array.isArray(item.options) ? item.options : [];
    const options: RescuedQuestionOption[] = [];
    for (const opt of optionsRaw) {
      if (options.length >= MAX_OPTIONS) break;
      if (!isRecord(opt)) continue;
      const labelRaw = typeof opt.label === "string" ? opt.label.trim() : "";
      const label = labelRaw.slice(0, MAX_LABEL_CHARS).trim();
      if (!label) continue;
      options.push({
        label,
        description: typeof opt.description === "string" ? opt.description : "",
      });
    }
    if (options.length < MIN_OPTIONS) continue;
    seenHeaders.add(headerKey);
    const normalized: RescuedQuestion = { header, question, options };
    if (typeof item.multiSelect === "boolean") {
      normalized.multiSelect = item.multiSelect;
    }
    out.push(normalized);
  }
  return out.length > 0 ? out : null;
}

/**
 * Balanced-brace extraction of the first JSON object (at or after the first
 * leak marker) that yields a contract-valid `questions` array. Returns null
 * when no parseable payload exists (e.g. the mangled short-key variant).
 */
export function extractQuestionsPayload(
  text: string,
): RescuedQuestion[] | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const block = findFirstLeakBlock(text);
  if (!block || block.payload === undefined) return null;
  return normalizeQuestions(block.payload);
}

/**
 * Remove leaked ask_user_question block(s) — from the first marker through
 * the end of the matched JSON / `[blocked]` / section-end tokens — and
 * return the surrounding prose trimmed. Mangled blocks (no balanced JSON)
 * strip through end of text.
 */
export function stripLeakedToolSyntax(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  let result = text;
  for (let guard = 0; guard < 8; guard++) {
    const block = findFirstLeakBlock(result);
    if (!block) break;
    const before = result.slice(0, block.start).trimEnd();
    const after = result.slice(block.end).trimStart();
    result = before && after ? `${before}\n\n${after}` : before || after;
  }
  return result.trim();
}

/** Readable markdown fallback — mirrors the intake's renderQuestionMarkdown
 *  shape so a failed re-post still leaves the user clean questions. */
function renderQuestionsMarkdown(questions: RescuedQuestion[]): string {
  const lines: string[] = [];
  for (const q of questions) {
    lines.push(`**${q.header}**`);
    lines.push("");
    lines.push(q.question);
    lines.push("");
    for (const opt of q.options) {
      const description = opt.description.trim();
      lines.push(
        description ? `- ${opt.label} — ${description}` : `- ${opt.label}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export interface RescueArgs {
  text: string;
  /** Intake POST callback. Pass null/undefined to strip only (eval mode,
   *  or the turn already asked natively). */
  post?: RescuePost | null;
}

/**
 * Detect → extract → re-post → strip.
 *
 * - Post success → stripped content only (the intake writes the question
 *   card message — appending the questions here would duplicate them) with
 *   `rescued: true` and the intake's questionId.
 * - Post 409 (a batch is already pending) → stripped content, not rescued —
 *   the existing card already shows questions; no fallback appended.
 * - Post failure (network/timeout/other HTTP) → stripped content PLUS a
 *   readable markdown rendering of the parsed questions — never leave the
 *   user raw token soup or silently swallow the questions.
 * - Unparseable payload or posting disabled → stripped content only.
 */
export async function rescueLeakedAskUserQuestion(
  args: RescueArgs,
): Promise<RescueResult> {
  const { text, post } = args;
  if (!detectLeakedAskUserQuestion(text)) {
    return { content: text, rescued: false };
  }
  const questions = extractQuestionsPayload(text);
  const stripped = stripLeakedToolSyntax(text);
  if (!questions || !post) {
    return { content: stripped, rescued: false };
  }

  let outcome: RescuePostOutcome;
  try {
    outcome = await post(questions);
  } catch {
    outcome = { ok: false };
  }

  if (outcome.ok) {
    return {
      content: stripped,
      rescued: true,
      ...(outcome.questionId ? { questionId: outcome.questionId } : {}),
    };
  }
  if (outcome.status === 409) {
    // A question is already pending for this thread — the user is already
    // looking at a card; stripping is enough.
    return { content: stripped, rescued: false };
  }
  const fallback = renderQuestionsMarkdown(questions);
  return {
    content: stripped ? `${stripped}\n\n${fallback}` : fallback,
    rescued: false,
  };
}

// ---------------------------------------------------------------------------
// Host helpers (server.ts wiring).
// ---------------------------------------------------------------------------

/** Minimal tool-invocation shape the host records (ToolInvocationRecord). */
interface ToolInvocationLike {
  name?: string;
  tool_name?: string;
  is_error?: boolean;
  result?: unknown;
}

/**
 * True when a native ask_user_question call already succeeded this turn —
 * a non-error invocation carrying the extension's endTurn sentinel. When
 * detection misses (shape drift), the intake's 409 still backstops a
 * double-ask.
 */
export function turnAlreadyAskedUserQuestion(
  toolInvocations: ToolInvocationLike[] | undefined,
): boolean {
  for (const invocation of toolInvocations ?? []) {
    const name = invocation.tool_name || invocation.name;
    if (name !== ASK_USER_QUESTION_TOOL_NAME) continue;
    if (invocation.is_error === true) continue;
    const result = invocation.result;
    if (!isRecord(result)) continue;
    const details = isRecord(result.details) ? result.details : null;
    const sentinel = details?.[ASK_USER_QUESTION_DETAIL_KEY];
    if (isRecord(sentinel) && sentinel.endTurn === true) return true;
  }
  return false;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Intake POST deadline — matches INTAKE_TIMEOUT_MS in the extension. */
const INTAKE_TIMEOUT_MS = 15_000;

export interface IntakeQuestionPostConfig {
  apiUrl: string;
  apiSecret: string;
  threadId: string;
  threadTurnId: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Build the intake POST callback — the exact request shape the
 * ask_user_question extension uses (POST
 * {apiUrl}/api/threads/{threadId}/questions, bearer apiSecret, body
 * {thread_turn_id, questions}), with the same 15s deadline.
 */
export function createIntakeQuestionPost(
  config: IntakeQuestionPostConfig,
): RescuePost {
  const apiUrl = config.apiUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? INTAKE_TIMEOUT_MS;
  return async (questions) => {
    const fetchImpl = config.fetchImpl ?? fetch;
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(
      () => timeoutController.abort(),
      timeoutMs,
    );
    try {
      const response = await fetchImpl(
        `${apiUrl}/api/threads/${config.threadId}/questions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiSecret}`,
            "Content-Type": "application/json",
            "User-Agent": "Thinkwork-AgentCore-Pi/1.0",
          },
          body: JSON.stringify({
            thread_turn_id: config.threadTurnId,
            questions,
          }),
          signal: timeoutController.signal,
        },
      );
      if (!response.ok) {
        return { ok: false, status: response.status };
      }
      const body: unknown = await response.json().catch(() => ({}));
      const questionId =
        isRecord(body) && typeof body.questionId === "string"
          ? body.questionId
          : undefined;
      return { ok: true, ...(questionId ? { questionId } : {}) };
    } catch {
      // Network failure / timeout.
      return { ok: false };
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}
