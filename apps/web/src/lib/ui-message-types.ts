/**
 * UIMessage / UIMessagePart / UIMessageChunk shapes for the AI Elements +
 * useChat adoption (plan 2026-05-09-012, contract v1).
 *
 * The Vercel `ai` package defines these types; we re-export the canonical
 * shapes so call sites that need a UIMessage import do not all reach into
 * `ai/dist` paths individually. Keep this module type-only so it stays
 * tree-shake-friendly and ESM-safe.
 *
 * Contract:
 *   docs/specs/computer-ai-elements-contract-v1.md
 */

import type {
  UIMessage as AiUIMessage,
  UIMessageChunk as AiUIMessageChunk,
  UIMessagePart as AiUIMessagePart,
  UITools,
} from "ai";
import type { ThreadGenUIData, ThreadGenUIPart } from "@thinkwork/genui";

/**
 * Default Computer-thread `UIMessage` shape. Computer threads do not lock the
 * tool vocabulary at the type level — agents can emit `tool-${name}` for any
 * registered Strands tool — so we leave `UITools` open and rely on the
 * AppSync chunk parser + per-part-id append cursor to handle the dynamic
 * shape at runtime.
 */
export type UIMessage = AiUIMessage<unknown, Record<string, unknown>, UITools>;

/**
 * Single part inside `UIMessage.parts` after the consumer has merged a
 * stream of chunks. Discriminator union mirrors the contract vocabulary
 * (`text | reasoning | tool-${name} | source-url | source-document | file |
 * data-${name} | step-start`).
 */
export type UIMessagePart = AiUIMessagePart<Record<string, unknown>, UITools>;

/**
 * Wire-format chunk emitted by Strands and carried inside
 * `ComputerThreadChunkEvent.chunk: AWSJSON`. The AI SDK lists every chunk
 * type the consumer needs to handle; the parser in
 * `ui-message-chunk-parser.ts` validates incoming JSON against this union.
 *
 * Note: not every chunk variant carries an `id` field (e.g. `start`,
 * `finish`, `start-step`, `finish-step`, `abort`, `error`,
 * `tool-input-available`, `tool-output-available`, `tool-input-start`,
 * `tool-input-delta`, `source-url`, `source-document`, `file`,
 * `message-metadata`). Legacy detection therefore MUST be shape-based, not
 * id-based — see the parser for the rule.
 */
export type UIMessageChunk = AiUIMessageChunk<unknown, Record<string, unknown>>;

/**
 * Legacy `{text}`-shape envelope produced by the pre-typed `appsync_publisher`
 * Python path and by non-Computer agents (Pi, sub-agents) sharing the
 * AgentCore runtime. The AppSync chunk parser detects this shape and routes
 * it to the legacy text-append fallback in `ui-message-merge.ts`. Once the
 * Phase 2 cleanup of plan-012 retires the legacy path entirely, this type
 * goes away.
 */
export interface LegacyTextChunk {
  text: string;
}

/**
 * Outcome of parsing one AppSync `chunk: AWSJSON` payload. Discriminated by
 * `kind` so consumers can branch without re-checking shapes.
 */
export type ParsedChunk =
  | { kind: "protocol"; chunk: UIMessageChunk }
  | { kind: "legacy"; chunk: LegacyTextChunk }
  | { kind: "drop"; reason: ParseDropReason; raw: unknown };

export type ParseDropReason =
  | "EMPTY"
  | "INVALID_JSON"
  | "NOT_OBJECT"
  | "UNKNOWN_TYPE"
  | "MALFORMED_PROTOCOL_FIELDS";

/**
 * Computer-thread chat id is the thread UUID. Pulled out as a brand to help
 * call sites avoid string-vs-string mistakes; runtime is still just a string.
 */
export type ComputerChatId = string & { readonly __brand: "ComputerChatId" };

export interface RunbookConfirmationCandidate {
  runbookSlug?: string;
  displayName?: string;
  description?: string;
  confidence?: number;
}

export interface RunbookConfirmationPhase {
  id?: string;
  title?: string;
  dependsOn?: unknown;
}

export interface RunbookConfirmationData {
  mode?: "approval" | "choice" | string;
  runbookRunId?: string;
  runbookSlug?: string;
  runbookVersion?: string;
  title?: string;
  displayName?: string;
  description?: string;
  summary?: string;
  status?: string;
  expectedOutputs?: unknown;
  likelyTools?: unknown;
  phaseSummary?: unknown;
  phases?: RunbookConfirmationPhase[];
  candidates?: RunbookConfirmationCandidate[];
  confidence?: number;
  matchedKeywords?: unknown;
}

/**
 * `data-user-question` part payload (plan 2026-06-09-005 U8). Written ONCE
 * at intake — questions only, never answer state. Answered state derives
 * from the message-level `userQuestion` GraphQL field (the
 * pending_user_questions row), not from parts mutation.
 */
export interface UserQuestionOption {
  label?: string;
  description?: string;
}

export interface UserQuestionItem {
  question?: string;
  header?: string;
  options?: UserQuestionOption[];
  multiSelect?: boolean;
}

export interface UserQuestionData {
  questionId?: string;
  questions?: UserQuestionItem[];
}

/** Lifecycle of a `pending_user_questions` row (GraphQL `UserQuestionStatus`). */
export type UserQuestionStatus = "PENDING" | "ANSWERED" | "CANCELLED";

/**
 * Answer-state record resolved from `Message.userQuestion`
 * (pending_user_questions row → GraphQL `UserQuestion`). Narrow raw GraphQL
 * status strings through `toUserQuestionStatus` in
 * `@/lib/user-question-record` at the mapping boundary.
 */
export interface UserQuestionRecord {
  id: string;
  status: UserQuestionStatus;
  /** AWSJSON — JSON string (or already-parsed object) of structured answers. */
  answers?: unknown | null;
  answeredVia?: string | null; // CARD | REPLY
  /** users.id of the answerer — never rendered directly (it's a UUID). */
  answeredBy?: string | null;
  /** Display name resolved by the caller (mention targets / current user). */
  answeredByDisplayName?: string | null;
  answeredAt?: string | null;
}

export interface RunbookQueueTask {
  id?: string;
  key?: string;
  taskKey?: string;
  title?: string;
  summary?: string;
  status?: string;
  dependsOn?: unknown;
  capabilityRoles?: unknown;
  sortOrder?: number;
}

export interface RunbookQueuePhase {
  id?: string;
  title?: string;
  tasks?: RunbookQueueTask[];
}

export interface RunbookQueueData {
  runbookRunId?: string;
  runbookSlug?: string;
  runbookVersion?: string;
  displayName?: string;
  status?: string;
  currentTaskKey?: string;
  sourceMessageId?: string;
  phases?: RunbookQueuePhase[];
}

export type TaskQueueStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

export type TaskQueueItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  | string;

export interface TaskQueueSource {
  type?:
    | "runbook"
    | "deep_research"
    | "artifact_build"
    | "map_build"
    | "manual_plan"
    | string;
  id?: string;
  slug?: string;
}

export interface TaskQueueItem {
  id?: string;
  title?: string;
  summary?: string | null;
  status?: TaskQueueItemStatus;
  output?: unknown;
  error?: unknown;
  startedAt?: string | null;
  completedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TaskQueueGroup {
  id?: string;
  title?: string;
  items?: TaskQueueItem[];
}

export interface TaskQueueData {
  queueId?: string;
  title?: string;
  status?: TaskQueueStatus;
  source?: TaskQueueSource;
  summary?: string;
  groups?: TaskQueueGroup[];
  items?: TaskQueueItem[];
}

export type GenUIData = ThreadGenUIData;
export type GenUIPart = ThreadGenUIPart;
