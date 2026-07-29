/**
 * Evidence ledger writes for external memory sources (THINK-193 U1).
 *
 * recordAcquiredPage is the acquisition commit point: evidence upsert,
 * run-item idempotency rows, and the checkpoint CAS advance all happen in
 * ONE transaction, so a lost CAS (concurrent worker on the same partition)
 * rolls back the whole page and the retry re-reads from the surviving
 * cursor. Replayed items (same source_config_id + source_item_id +
 * source_version already in the ledger) are counted as 'seen', not
 * re-processed.
 */

import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import {
  memoryClaimEvidence,
  memoryDerivations,
  memoryEvidenceItems,
  memoryRunItems,
  memorySourceCheckpoints,
  type MemoryRunItemResult,
  type MemoryRunItemStage,
} from "@thinkwork/database-pg/schema";

import { CheckpointConflictError, advanceCheckpoint } from "./repository.js";
import type {
  DbHandle,
  EvidenceRow,
  EvidenceUpsert,
  MemoryDerivationRow,
  SourceCheckpoint,
} from "./types.js";

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

/** JSON.stringify with object keys sorted recursively (arrays keep order). */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value)) ?? "undefined";
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object" && value.constructor === Object) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** sha256 hex of the stable-stringified value — the evidence content hash. */
export function computeContentHash(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value), "utf8")
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested; the transaction below composes them)
// ---------------------------------------------------------------------------

/** In-memory key matching the evidence unique target within one source.
 * JSON-encoded tuple: crafted ids/versions containing any delimiter cannot
 * collide with another (id, version) pair. */
export function evidenceConflictKey(item: {
  sourceItemId: string;
  sourceVersion: string;
}): string {
  return JSON.stringify([item.sourceItemId, item.sourceVersion]);
}

/**
 * memory_run_items values for an acquire page: items whose
 * (source_item_id, source_version) was freshly inserted are 'changed',
 * replays are 'seen'.
 */
export function buildAcquireRunItemValues(args: {
  tenantId: string;
  workflowRunId: string;
  sourceConfigId: string;
  items: EvidenceUpsert[];
  changedKeys: ReadonlySet<string>;
}): Array<typeof memoryRunItems.$inferInsert> {
  return args.items.map((item) => ({
    tenant_id: args.tenantId,
    workflow_run_id: args.workflowRunId,
    source_config_id: args.sourceConfigId,
    source_item_id: item.sourceItemId,
    stage: "acquire" as const,
    result: args.changedKeys.has(evidenceConflictKey(item))
      ? ("changed" as const)
      : ("seen" as const),
    detail: { source_version: item.sourceVersion },
  }));
}

// ---------------------------------------------------------------------------
// Acquisition commit
// ---------------------------------------------------------------------------

/**
 * Commit one acquired page atomically:
 *  (a) upsert evidence (ON CONFLICT DO NOTHING on source_config_id +
 *      source_item_id + source_version), collecting freshly-inserted rows
 *      as 'changed'; older active versions of changed items are marked
 *      lifecycle='superseded';
 *  (b) insert stage='acquire' run items (idempotent per run);
 *  (c) CAS-advance the checkpoint — a lost CAS throws
 *      CheckpointConflictError and rolls the whole page back.
 */
export async function recordAcquiredPage(
  db: Database,
  args: {
    tenantId: string;
    sourceConfigId: string;
    workflowRunId: string;
    partitionKey: string;
    expectedCheckpointVersion: number;
    nextCursor: Record<string, unknown>;
    items: EvidenceUpsert[];
    /**
     * Backscan/reconciliation mode (Codex F4): record evidence + run items
     * transactionally but leave the checkpoint untouched — an unfiltered
     * sweep must never advance the incremental high-water mark. Evidence
     * dedupe by content-sensitive source_version makes rescans no-ops.
     */
    skipCheckpointAdvance?: boolean;
    /**
     * Erase write-fence (round-3 P1-2): when present, the transaction FOR
     * SHARE-locks the source config row and aborts (rolls the whole page
     * back) if the source is disabled or its erase_generation moved past
     * the value captured at stage start.
     */
    eraseFence?: { expectedEraseGeneration: number };
  },
): Promise<{
  changed: EvidenceRow[];
  seen: number;
  checkpoint: SourceCheckpoint;
}> {
  return await db.transaction(async (tx) => {
    if (args.eraseFence) {
      const { assertSourceWritable } = await import("./erase-fence.js");
      await assertSourceWritable(tx, {
        tenantId: args.tenantId,
        sourceConfigId: args.sourceConfigId,
        expectedEraseGeneration: args.eraseFence.expectedEraseGeneration,
        lock: true,
      });
    }
    // (a) Evidence upsert — RETURNING yields only freshly-inserted rows.
    let changed: EvidenceRow[] = [];
    if (args.items.length > 0) {
      changed = await tx
        .insert(memoryEvidenceItems)
        .values(
          args.items.map((item) => ({
            tenant_id: args.tenantId,
            source_config_id: args.sourceConfigId,
            source_item_id: item.sourceItemId,
            source_version: item.sourceVersion,
            source_timestamp: item.sourceTimestamp ?? null,
            content_hash: item.contentHash,
            acquisition_run_id: args.workflowRunId,
            target_scope: item.targetScope,
            target_id: item.targetId,
            lifecycle: "active",
            sensitivity: item.sensitivity ?? null,
            snapshot_ref: item.snapshotRef ?? null,
            // F6 boundary: when the adapter already uploaded the snapshot to
            // S3 (snapshotRef set), the raw content must NOT also land inline
            // in Postgres where analyst_reader could reach it. The only thing
            // allowed inline alongside a ref is an explicit CONTENT-FREE
            // skeleton (U6 email privacy: ids/labels/counts/hash, marked
            // contentFree: true — see EvidenceUpsert.inlineSkeleton). Inline
            // full-snapshot storage remains only as the pre-upload back-compat
            // path; offloadSnapshots (stages.ts) migrates those rows to S3 on
            // the next project run.
            normalized_snapshot: item.snapshotRef
              ? (item.inlineSkeleton ?? null)
              : item.normalizedSnapshot,
            extraction_recipe: item.extractionRecipe,
          })),
        )
        .onConflictDoNothing({
          target: [
            memoryEvidenceItems.source_config_id,
            memoryEvidenceItems.source_item_id,
            memoryEvidenceItems.source_version,
          ],
        })
        .returning();
    }

    // Supersede older active versions of items that just got a new version.
    // Their claim-support edges deliberately STAY ACTIVE here (Codex round-4
    // P1-A): retracting them at acquire time left active claims with zero
    // active support if the project stage crashed before the replacement
    // edition's supports landed. The retirement of superseded-edition edges
    // now happens atomically inside upsertClaimsForEvidence's transaction,
    // together with the new edition's supports and the zero-support sweep.
    // Between acquire and project the invariant "active edges only point at
    // active evidence" is therefore transiently violated BY DESIGN (see
    // scripts/memory-sources/verify-claim-invariants.sql — quiescent
    // invariant).
    if (changed.length > 0) {
      await tx
        .update(memoryEvidenceItems)
        .set({ lifecycle: "superseded", updated_at: new Date() })
        .where(
          and(
            eq(memoryEvidenceItems.source_config_id, args.sourceConfigId),
            eq(memoryEvidenceItems.lifecycle, "active"),
            inArray(
              memoryEvidenceItems.source_item_id,
              changed.map((row) => row.source_item_id),
            ),
            notInArray(
              memoryEvidenceItems.id,
              changed.map((row) => row.id),
            ),
          ),
        );
    }

    // (b) Run-item idempotency ledger (replay-safe within the run).
    const changedKeys = new Set(
      changed.map((row) =>
        evidenceConflictKey({
          sourceItemId: row.source_item_id,
          sourceVersion: row.source_version,
        }),
      ),
    );
    const runItemValues = buildAcquireRunItemValues({
      tenantId: args.tenantId,
      workflowRunId: args.workflowRunId,
      sourceConfigId: args.sourceConfigId,
      items: args.items,
      changedKeys,
    });
    if (runItemValues.length > 0) {
      await tx
        .insert(memoryRunItems)
        .values(runItemValues)
        .onConflictDoNothing({
          target: [
            memoryRunItems.workflow_run_id,
            memoryRunItems.source_config_id,
            memoryRunItems.source_item_id,
            memoryRunItems.stage,
          ],
        });
    }

    // (c) Checkpoint CAS — failure rolls back (a) and (b) with us. In
    // skipCheckpointAdvance mode the checkpoint is read, not advanced.
    if (args.skipCheckpointAdvance) {
      const [current] = await tx
        .select()
        .from(memorySourceCheckpoints)
        .where(
          and(
            eq(memorySourceCheckpoints.source_config_id, args.sourceConfigId),
            eq(memorySourceCheckpoints.partition_key, args.partitionKey),
          ),
        )
        .limit(1);
      if (!current) {
        throw new Error(
          `checkpoint for source ${args.sourceConfigId} partition '${args.partitionKey}' is missing during a backscan page`,
        );
      }
      return {
        changed,
        seen: args.items.length - changed.length,
        checkpoint: current,
      };
    }

    const checkpoint = await advanceCheckpoint(tx, {
      sourceConfigId: args.sourceConfigId,
      partitionKey: args.partitionKey,
      expectedVersion: args.expectedCheckpointVersion,
      cursor: args.nextCursor,
    });
    if (!checkpoint) {
      throw new CheckpointConflictError(
        `checkpoint CAS lost for source ${args.sourceConfigId} partition '${args.partitionKey}' at version ${args.expectedCheckpointVersion} — page rolled back`,
      );
    }

    return { changed, seen: args.items.length - changed.length, checkpoint };
  });
}

/**
 * Evidence rows this run acquired as 'changed' and that are still active —
 * the projection stage's work list.
 */
export async function listEvidenceForProjection(
  db: DbHandle,
  args: { sourceConfigId: string },
): Promise<EvidenceRow[]> {
  // Staleness-based, not same-run-based: any ACTIVE evidence row with no
  // ACTIVE derivation pointing at it still needs projection/retain —
  // regardless of which run acquired it. This makes a retry run self-heal
  // after a post-acquire stage failure (the rerun's acquire classifies the
  // rows as "seen", but they remain unprojected and must not be stranded).
  // recordDerivation repoints evidence_item_id to the latest retained
  // evidence row, so a retained row joins and is excluded.
  const rows = await db
    .select({ evidence: memoryEvidenceItems })
    .from(memoryEvidenceItems)
    .leftJoin(
      memoryDerivations,
      and(
        eq(memoryDerivations.evidence_item_id, memoryEvidenceItems.id),
        eq(memoryDerivations.lifecycle, "active"),
      ),
    )
    .where(
      and(
        eq(memoryEvidenceItems.source_config_id, args.sourceConfigId),
        eq(memoryEvidenceItems.lifecycle, "active"),
        isNull(memoryDerivations.id),
      ),
    )
    // Deterministic order so bounded batches + continuation runs (F7) walk
    // the backlog stably instead of re-shuffling it every invocation.
    .orderBy(asc(memoryEvidenceItems.id));
  return rows.map((row) => row.evidence);
}

/**
 * Idempotent single run-item insert for the later stages (project / retain /
 * compound / …). Returns true when inserted, false when this
 * (run, source, item, stage) row already existed.
 */
export async function recordRunItem(
  db: DbHandle,
  args: {
    tenantId: string;
    workflowRunId: string;
    sourceConfigId: string;
    sourceItemId: string;
    stage: MemoryRunItemStage;
    result: MemoryRunItemResult;
    detail?: Record<string, unknown>;
  },
): Promise<boolean> {
  const inserted = await db
    .insert(memoryRunItems)
    .values({
      tenant_id: args.tenantId,
      workflow_run_id: args.workflowRunId,
      source_config_id: args.sourceConfigId,
      source_item_id: args.sourceItemId,
      stage: args.stage,
      result: args.result,
      detail: args.detail ?? {},
    })
    .onConflictDoNothing({
      target: [
        memoryRunItems.workflow_run_id,
        memoryRunItems.source_config_id,
        memoryRunItems.source_item_id,
        memoryRunItems.stage,
      ],
    })
    .returning({ id: memoryRunItems.id });
  return inserted.length > 0;
}

export interface RecordDerivationArgs {
  tenantId: string;
  sourceConfigId: string;
  evidenceItemId: string;
  projectionKey: string;
  targetBankId: string;
  hindsightDocumentId: string;
  currentVersion: string;
}

export interface RecordRunItemArgs {
  tenantId: string;
  workflowRunId: string;
  sourceConfigId: string;
  sourceItemId: string;
  stage: MemoryRunItemStage;
  result: MemoryRunItemResult;
  detail?: Record<string, unknown>;
}

/**
 * Derivation upsert body, transaction-scoped. One active derivation per
 * (source_config_id, projection_key): if one exists it is updated in place
 * (same stable memory document, new evidence version); otherwise a new
 * row is inserted. Uses SELECT … FOR UPDATE because drizzle's onConflict
 * targets can't address the partial unique index — the index still
 * backstops races as a hard constraint.
 */
async function upsertDerivationInTx(
  tx: DbHandle,
  args: RecordDerivationArgs,
): Promise<MemoryDerivationRow> {
  const [existing] = await tx
    .select()
    .from(memoryDerivations)
    .where(
      and(
        eq(memoryDerivations.source_config_id, args.sourceConfigId),
        eq(memoryDerivations.projection_key, args.projectionKey),
        eq(memoryDerivations.lifecycle, "active"),
      ),
    )
    .limit(1)
    .for("update");
  if (existing) {
    const [updated] = await tx
      .update(memoryDerivations)
      .set({
        evidence_item_id: args.evidenceItemId,
        target_bank_id: args.targetBankId,
        hindsight_document_id: args.hindsightDocumentId,
        current_version: args.currentVersion,
        updated_at: new Date(),
      })
      .where(eq(memoryDerivations.id, existing.id))
      .returning();
    return updated;
  }
  const [inserted] = await tx
    .insert(memoryDerivations)
    .values({
      tenant_id: args.tenantId,
      source_config_id: args.sourceConfigId,
      evidence_item_id: args.evidenceItemId,
      projection_key: args.projectionKey,
      target_bank_id: args.targetBankId,
      hindsight_document_id: args.hindsightDocumentId,
      current_version: args.currentVersion,
      lifecycle: "active",
    })
    .returning();
  return inserted;
}

/** Record evidence → memory-document lineage (see upsertDerivationInTx). */
export async function recordDerivation(
  db: Database,
  args: RecordDerivationArgs,
): Promise<MemoryDerivationRow> {
  return await db.transaction(async (tx) => upsertDerivationInTx(tx, args));
}

/**
 * Codex F8: commit the derivation AND its stage run-item in ONE
 * transaction, called AFTER the (idempotent) memory write. Committing
 * them separately lets a crash land the derivation without the run item —
 * the staleness-based work list (listEvidenceForProjection) then sees an
 * active derivation and skips the evidence forever, while the run ledger
 * says the item was never retained. All-or-nothing keeps retry semantics:
 * either both landed, or the evidence stays selectable for the next run.
 */
export async function recordDerivationWithRunItem(
  db: Database,
  args: {
    derivation: RecordDerivationArgs;
    runItem: RecordRunItemArgs;
    /** Erase write-fence (round-3 P1-2) — see recordAcquiredPage. */
    eraseFence?: { expectedEraseGeneration: number };
  },
): Promise<MemoryDerivationRow> {
  return await db.transaction(async (tx) => {
    if (args.eraseFence) {
      const { assertSourceWritable } = await import("./erase-fence.js");
      await assertSourceWritable(tx, {
        tenantId: args.derivation.tenantId,
        sourceConfigId: args.derivation.sourceConfigId,
        expectedEraseGeneration: args.eraseFence.expectedEraseGeneration,
        lock: true,
      });
    }
    const derivation = await upsertDerivationInTx(tx, args.derivation);
    await recordRunItem(tx, args.runItem);
    return derivation;
  });
}

// Re-export so evidence-stage callers get the conflict error from one place.
export { CheckpointConflictError } from "./repository.js";
