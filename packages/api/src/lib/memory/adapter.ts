/**
 * ThinkWork memory contract — adapter interface.
 *
 * One of these is implemented per long-term memory engine (Hindsight,
 * AgentCore Memory, future graph adapters). Exactly one adapter is active
 * per deployment, resolved from {@link MemoryConfig.engine}. The recall,
 * inspect, and export services sit above this boundary and never touch
 * backend-native shapes.
 *
 * Defined per `.prds/memory-implementation-plan.md` §8.
 */

import type {
  ExportRequest,
  InspectRequest,
  MemoryCapabilities,
  MemoryEngineType,
  MemoryExportBundle,
  RecallRequest,
  RecallResult,
  RetainRequest,
  RetainResult,
  RetainConversationRequest,
  RetainDailyMemoryRequest,
  RetainTurnRequest,
  TenantInspectRequest,
  ThinkWorkMemoryRecord,
  UpsertMarkdownMemoryDocumentRequest,
} from "./types.js";

export interface MemoryAdapter {
  readonly kind: MemoryEngineType;

  capabilities(): Promise<MemoryCapabilities>;

  recall(request: RecallRequest): Promise<RecallResult[]>;

  retain(request: RetainRequest): Promise<RetainResult>;

  /**
   * Ingest a conversational turn for background extraction. Engines
   * decide their own extraction strategy: AgentCore feeds the
   * background semantic/preferences/summaries/episodes pipelines via
   * CreateEvent; Hindsight feeds the conversation to its own
   * LLM-based fact extractor. Distinct from {@link retain}, which
   * stores a single pre-extracted fact.
   */
  retainTurn(request: RetainTurnRequest): Promise<void>;

  retainConversation?(request: RetainConversationRequest): Promise<void>;

  retainDailyMemory?(request: RetainDailyMemoryRequest): Promise<void>;

  upsertMarkdownMemoryDocument?(
    request: UpsertMarkdownMemoryDocumentRequest,
  ): Promise<void>;

  /**
   * Idempotently apply per-bank configuration (observation mission,
   * consolidation settings) for the owner's bank. Implementations must
   * never throw — a failed config apply logs and continues so the write
   * that triggered it is not blocked.
   */
  ensureBankConfigured?(ownerId: string): Promise<void>;

  /**
   * Drive the engine's native bank consolidation (dedupe, contradiction
   * reconciliation, decay). Raw-bank-id variant used by the dream state
   * (THINK-133 U4) and ops scripts.
   */
  consolidateBankById?(bankId: string): Promise<void>;

  /**
   * Delete one engine document by its stable document id, cascading to the
   * memory units and links extracted from it.
   *
   * Pinned to the Hindsight 0.8.4 document-delete contract
   * (`DELETE /v1/default/banks/<bankId>/documents/<documentId>` returns 200
   * and cascades to units/links; see
   * docs/solutions/tooling-decisions/hindsight-084-document-lifecycle-probe-2026-07-11.md).
   * Gated by the lifecycle contract test
   * (`adapters/hindsight-document-lifecycle.test.ts`). Returns "not_found"
   * for an already-absent document (idempotent success). Callers must treat
   * absence of this method as retraction-unsupported for the engine.
   */
  deleteDocument?(req: {
    tenantId: string;
    ownerType: "user" | "agent" | "space" | "tenant";
    ownerId: string;
    documentId: string;
  }): Promise<"deleted" | "not_found">;

  inspect(request: InspectRequest): Promise<ThinkWorkMemoryRecord[]>;

  inspectTenant?(
    request: TenantInspectRequest,
  ): Promise<ThinkWorkMemoryRecord[]>;

  /**
   * List the owner's session-scoped episodic records (and any cross-session
   * reflections filed alongside them).
   *
   * Deliberately separate from {@link inspect}: episodes are per-thread and
   * would swamp the cross-thread listing/recall fan-out. Engines that don't
   * model episodes omit this method, and callers must treat its absence as
   * "no episodic facet available" rather than an error.
   */
  listEpisodicRecords?(
    request: InspectRequest,
  ): Promise<ThinkWorkMemoryRecord[]>;

  export(request: ExportRequest): Promise<MemoryExportBundle>;

  forget?(recordId: string): Promise<void>;

  update?(recordId: string, content: string): Promise<void>;

  reflect?(request: RecallRequest): Promise<RecallResult[]>;

  compact?(request: InspectRequest): Promise<void>;

  /**
   * Cursor-based incremental read for the compiler pipeline. Returns records
   * whose `(updated_at, id)` is strictly greater than the supplied cursor,
   * ordered by `(updated_at, id)` ascending. The tiebreaker is required to
   * handle same-timestamp records without missing or double-reading.
   *
   * v1 is strictly user-scoped; `ownerId` is the user id and corresponds to
   * one user's Hindsight bank.
   * Engines that can't produce monotonic change records (AgentCore) should
   * throw a clear "not implemented" error so the compile enqueue path can
   * skip them explicitly.
   */
  listRecordsUpdatedSince?(
    request: ListRecordsUpdatedSinceRequest,
  ): Promise<ListRecordsUpdatedSinceResult>;
}

export interface ListRecordsUpdatedSinceRequest {
  tenantId: string;
  ownerType?: "user" | "agent" | "space" | "tenant";
  ownerId: string;
  sinceUpdatedAt?: Date;
  sinceRecordId?: string;
  limit: number;
}

export interface ListRecordsUpdatedSinceResult {
  records: ThinkWorkMemoryRecord[];
  nextCursor: { updatedAt: Date; recordId: string } | null;
}
