/**
 * ThinkWork memory contract — normalized types.
 *
 * These are the canonical shapes every memory consumer (API resolvers, MCP
 * tools, inspect/export helpers, and eventually runtime recall) sees after
 * passing through a {@link MemoryAdapter}. Hindsight is the hosted canonical
 * memory foundation, so Hindsight memory-domain concepts that affect retain
 * quality, recall filtering, temporal grounding, or evidence are modeled below
 * instead of being hidden in untyped metadata. Raw backend/database internals
 * still stay encapsulated by the adapter.
 *
 * Defined per `.prds/memory-implementation-plan.md` §8–9.
 */

export type MemoryEngineType = "hindsight" | "agentcore" | "cognee";

export type MemoryOwnerRef = {
  tenantId: string;
  ownerType: "user" | "agent" | "space";
  ownerId: string;
  threadId?: string;
};

export type MemoryRecordKind = "event" | "unit" | "reflection";

export type MemoryStrategy =
  | "semantic"
  | "preferences"
  | "summaries"
  | "episodes"
  | "graph"
  | "custom";

export type MemorySourceType =
  | "thread_turn"
  | "explicit_remember"
  | "connector_event"
  | "system_reflection"
  | "import";

export type MemoryStatus = "active" | "archived" | "deleted" | "superseded";

export type MemoryBackendRef = {
  backend: MemoryEngineType | string;
  ref: string;
};

export type RecallDepth = "quick" | "deep";
export type HindsightRecallBudget = "low" | "mid" | "high";
export type HindsightRecallFactType = "world" | "experience" | "observation";
export type HindsightTagsMatch =
  | "any"
  | "all"
  | "any_strict"
  | "all_strict";

export type HindsightObservationScopes =
  | "combined"
  | "per_tag"
  | "all_combinations"
  | string[][];

export type HindsightRetainOptions = {
  /**
   * Hindsight first-class event timestamp. Use `"unset"` for timeless
   * reference material; omit when the service should use ingestion time.
   */
  timestamp?: string | null;
  /** Item-level visibility/source tags used by recall and consolidation. */
  tags?: string[];
  /** Request-level document grouping tags accepted by Hindsight retain. */
  documentTags?: string[];
  /** Observation consolidation scope strategy or explicit tag-set scopes. */
  observationScopes?: HindsightObservationScopes | null;
};

export type HindsightTokenBudgetOptions = {
  maxTokens?: number;
};

export type HindsightSourceFactsIncludeOptions =
  HindsightTokenBudgetOptions & {
    maxTokensPerObservation?: number;
  };

export type HindsightToolCallsIncludeOptions = {
  output?: boolean;
};

export type HindsightIncludeOptions = {
  entities?: boolean | null | HindsightTokenBudgetOptions;
  chunks?: boolean | null | HindsightTokenBudgetOptions;
  sourceFacts?: boolean | null | HindsightSourceFactsIncludeOptions;
  /** Reflect-only: request `based_on` memories, mental models, and directives. */
  facts?: boolean | null;
  /** Reflect-only: request tool-call trace details. */
  toolCalls?: boolean | null | HindsightToolCallsIncludeOptions;
};

export type HindsightRecallOptions = {
  budget?: HindsightRecallBudget;
  maxTokens?: number;
  types?: HindsightRecallFactType[];
  includeEntities?: boolean;
  includeLegacyBanks?: boolean;
  activeSpace?: {
    spaceId?: string | null;
    spaceSlug?: string | null;
    isDefault?: boolean | null;
  };
  trace?: boolean;
  queryTimestamp?: string | null;
  tags?: string[];
  tagsMatch?: HindsightTagsMatch;
  tagGroups?: unknown[];
  include?: HindsightIncludeOptions;
  responseSchema?: Record<string, unknown> | null;
};

export type MemoryRequestContext = {
  contextClass?: string;
  computerId?: string;
  requesterUserId?: string;
  sourceSurface?: string;
  credentialSubject?: {
    type: "user" | "service";
    userId?: string | null;
    connectionId?: string | null;
    provider?: string | null;
  };
  event?: {
    provider?: string | null;
    eventType?: string | null;
    eventId?: string | null;
    metadata?: Record<string, unknown> | null;
  };
};

export type ThinkWorkMemoryRecord = {
  id: string;
  tenantId: string;
  ownerType: "user" | "agent" | "space";
  ownerId: string;
  threadId?: string;
  kind: MemoryRecordKind;
  sourceType: MemorySourceType;
  strategy?: MemoryStrategy;
  status: MemoryStatus;
  content: {
    text: string;
    summary?: string;
  };
  provenance?: {
    threadMessageIds?: string[];
    turnIds?: string[];
    sourceEventIds?: string[];
  };
  backendRefs: MemoryBackendRef[];
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type HindsightEvidenceSourceFact = {
  id: string;
  type?: string | null;
  context?: string | null;
  documentId?: string | null;
  chunkId?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown>;
};

export type HindsightBasedOnEvidence = {
  memoryIds: string[];
  mentalModelIds: string[];
  directiveIds: string[];
  memories?: HindsightEvidenceSourceFact[];
  mentalModels?: HindsightEvidenceSourceFact[];
  directives?: HindsightEvidenceSourceFact[];
};

export type HindsightEvidence = {
  sourceFactIds?: string[];
  sourceFacts?: HindsightEvidenceSourceFact[];
  basedOn?: HindsightBasedOnEvidence;
};

export type HindsightRecordDetail = {
  evidence?: HindsightEvidence;
  trace?: unknown;
  usage?: unknown;
};

export type RecallRequest = MemoryOwnerRef & {
  query: string;
  limit?: number;
  tokenBudget?: number;
  strategies?: MemoryStrategy[];
  depth?: RecallDepth;
  hindsight?: HindsightRecallOptions;
  requestContext?: MemoryRequestContext;
};

export type RecallResult = {
  record: ThinkWorkMemoryRecord;
  score: number;
  whyRecalled?: string;
  backend: MemoryEngineType | string;
};

export type RetainRequest = MemoryOwnerRef & {
  sourceType: MemorySourceType;
  content: string;
  role?: "user" | "assistant" | "system";
  hindsight?: HindsightRetainOptions;
  metadata?: Record<string, unknown>;
};

export type RetainResult = {
  record: ThinkWorkMemoryRecord;
  backend: MemoryEngineType | string;
};

/**
 * A conversational turn ingested for background extraction.
 *
 * Distinct from {@link RetainRequest} (which is a single explicit fact).
 * `retainTurn` exists so engines can do their own extraction work on the
 * raw conversation: AgentCore feeds CreateEvent → background strategies
 * (semantic / preferences / summaries / episodes); Hindsight feeds the
 * same conversation to its own LLM-based extraction pipeline. Both keep
 * the runtime out of the extraction business.
 */
export type RetainTurnRequest = MemoryOwnerRef & {
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp?: string;
  }>;
  metadata?: Record<string, unknown>;
};

export type RetainConversationRequest = MemoryOwnerRef & {
  threadId: string;
  messages: Array<{
    role: "user" | "assistant" | "system" | string;
    content: string;
    timestamp: string;
  }>;
  hindsight?: HindsightRetainOptions;
  metadata?: Record<string, unknown>;
};

export type RetainDailyMemoryRequest = MemoryOwnerRef & {
  date: string;
  content: string;
  hindsight?: HindsightRetainOptions;
  metadata?: Record<string, unknown>;
};

export type UpsertMarkdownMemoryDocumentRequest = MemoryOwnerRef & {
  path: string;
  content: string;
  documentId: string;
  context: string;
  async?: boolean;
  hindsight?: HindsightRetainOptions;
  metadata?: Record<string, unknown>;
};

export type InspectRequest = MemoryOwnerRef & {
  kinds?: MemoryRecordKind[];
  cursor?: string;
  limit?: number;
};

export type TenantInspectRequest = {
  tenantId: string;
  query?: string;
  limit?: number;
};

export type ExportRequest = MemoryOwnerRef & {
  includeArchived?: boolean;
};

export type MemoryCapabilities = {
  retain: boolean;
  recall: boolean;
  spaceMemory: boolean;
  inspectRecords: boolean;
  inspectGraph: boolean;
  export: boolean;
  reflect: boolean;
  compact: boolean;
  forget: boolean;
};

export type MemoryExportBundle = {
  version: "v1";
  exportedAt: string;
  engine: MemoryEngineType | string;
  owner: MemoryOwnerRef;
  capabilities: MemoryCapabilities;
  records: ThinkWorkMemoryRecord[];
};
