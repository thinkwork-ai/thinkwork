/**
 * ThinkWork memory contract — normalized types.
 *
 * These are the canonical shapes every memory consumer (API resolvers, MCP
 * tools, inspect/export helpers, and eventually runtime recall) sees after
 * passing through a {@link MemoryAdapter}. Adapter-specific fields
 * (Hindsight `fact_type`, AgentCore namespace details, etc.) live under
 * {@link ThinkWorkMemoryRecord.metadata}, never as first-class fields.
 *
 * Defined per `.prds/memory-implementation-plan.md` §8–9.
 */

export type MemoryEngineType = "hindsight" | "agentcore";

export type MemoryOwnerRef = {
  tenantId: string;
  ownerType: "user" | "agent";
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

export type HindsightRecallOptions = {
  budget?: HindsightRecallBudget;
  maxTokens?: number;
  types?: HindsightRecallFactType[];
  includeEntities?: boolean;
  includeLegacyBanks?: boolean;
  trace?: boolean;
};

export type ThinkWorkMemoryRecord = {
  id: string;
  tenantId: string;
  ownerType: "user" | "agent";
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

export type RecallRequest = MemoryOwnerRef & {
  query: string;
  limit?: number;
  tokenBudget?: number;
  strategies?: MemoryStrategy[];
  depth?: RecallDepth;
  hindsight?: HindsightRecallOptions;
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
  metadata?: Record<string, unknown>;
};

export type RetainDailyMemoryRequest = MemoryOwnerRef & {
  date: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type InspectRequest = MemoryOwnerRef & {
  kinds?: MemoryRecordKind[];
  cursor?: string;
  limit?: number;
};

export type ExportRequest = MemoryOwnerRef & {
  includeArchived?: boolean;
};

export type MemoryCapabilities = {
  retain: boolean;
  recall: boolean;
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
