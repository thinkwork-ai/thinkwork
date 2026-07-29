/**
 * ThinkWork memory contract — adapter interface.
 *
 * One of these is implemented per long-term memory engine. AgentCore Memory
 * is the only engine today (THINK-406); the interface survives so future
 * engines can slot in. The recall, inspect, and export services sit above
 * this boundary and never touch backend-native shapes.
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
  RetainTurnRequest,
  ThinkWorkMemoryRecord,
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
   * CreateEvent. Distinct from {@link retain}, which stores a single
   * pre-extracted fact.
   */
  retainTurn(request: RetainTurnRequest): Promise<void>;

  inspect(request: InspectRequest): Promise<ThinkWorkMemoryRecord[]>;

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

  /**
   * Cursor-based incremental read for the compiler pipeline. Returns records
   * whose `(updated_at, id)` is strictly greater than the supplied cursor,
   * ordered by `(updated_at, id)` ascending. The tiebreaker is required to
   * handle same-timestamp records without missing or double-reading.
   *
   * v1 is strictly user-scoped; `ownerId` is the user id. Engines that
   * can't produce monotonic change records should throw a clear
   * "not implemented" error so the compile enqueue path can skip them
   * explicitly.
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
