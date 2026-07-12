/**
 * Shared domain types for external memory sources (THINK-193 U1).
 *
 * Row types derive from the drizzle schema in
 * packages/database-pg/src/schema/memory-sources.ts; only worker/adapter
 * exchange shapes (EvidenceUpsert, AcquiredPage, StageResultCounts) are
 * declared here.
 */

import type { Database } from "@thinkwork/database-pg";
import type {
  memoryDerivations,
  memoryEvidenceItems,
  memoryProcessorConfigs,
  memoryRunItems,
  memorySourceCheckpoints,
  memorySourceConfigs,
  MemoryRunItemResult,
  MemoryTargetScope,
} from "@thinkwork/database-pg/schema";

/** A drizzle transaction handle (what `db.transaction((tx) => …)` passes). */
export type DbTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/** Either the root db client or a transaction — all queries accept both. */
export type DbHandle = Database | DbTransaction;

export type MemoryProcessorConfig = typeof memoryProcessorConfigs.$inferSelect;
export type MemorySourceConfig = typeof memorySourceConfigs.$inferSelect;
export type SourceCheckpoint = typeof memorySourceCheckpoints.$inferSelect;
export type EvidenceRow = typeof memoryEvidenceItems.$inferSelect;
export type MemoryRunItemRow = typeof memoryRunItems.$inferSelect;
export type MemoryDerivationRow = typeof memoryDerivations.$inferSelect;

/** Shared processors may only target space or tenant banks (R11/AE7). */
export type SharedTargetScope = Extract<MemoryTargetScope, "space" | "tenant">;

/**
 * Scopes evidence/claim WRITES may target (THINK-193 U6): personal-capable
 * families (email) additionally write the owner's User Bank. Shared-only
 * APIs (graph/wiki publication, shared workflow provisioning) keep
 * SharedTargetScope.
 */
export type EvidenceTargetScope = MemoryTargetScope;

/** One normalized source item, as produced by a source-family adapter. */
export interface EvidenceUpsert {
  sourceItemId: string;
  sourceVersion: string;
  sourceTimestamp?: Date | null;
  /** sha256 hex of the stable-stringified normalized snapshot. */
  contentHash: string;
  normalizedSnapshot: Record<string, unknown> | null;
  /** Recipe/model/ontology version used for extraction. */
  extractionRecipe: Record<string, unknown>;
  targetScope: EvidenceTargetScope;
  targetId: string;
  sensitivity?: string | null;
  /** Optional S3 ref for the raw snapshot. */
  snapshotRef?: string | null;
  /**
   * Content-free inline skeleton stored in Postgres ALONGSIDE an S3
   * snapshotRef (THINK-193 U6 email privacy). Must carry `contentFree: true`
   * and no message bodies/subjects/snippets — only ids, label ids, counts,
   * and hashes. Ignored when snapshotRef is absent.
   */
  inlineSkeleton?: Record<string, unknown> | null;
}

/** One acquired page from a source adapter, plus its resume cursor. */
export interface AcquiredPage<TCursor> {
  items: EvidenceUpsert[];
  nextCursor: TCursor | null;
  /** Raw items fetched before boundary filtering — for budget accounting. */
  rawCount: number;
  /**
   * Provider-opaque continuation token for the NEXT page within this run
   * (null when the provider reports no further pages or exposes none).
   * Distinct from `nextCursor`, which is the durable cross-run checkpoint.
   */
  pageToken?: string | null;
}

/** Per-result counts a stage reports (e.g. { changed: 3, seen: 12 }). */
export type StageResultCounts = Partial<Record<MemoryRunItemResult, number>>;
