/**
 * eraseMemorySource — disable a source config and erase its footprint
 * (THINK-193 U2, Codex P1 #4 + rounds 5-7): the erase is a durable AGGREGATE
 * over the per-document retraction saga.
 *
 * Initiation is ATOMIC (beginSourceErase): one transaction tenant-pins the
 * source row, disables it, bumps the erase write-fence generation, and
 * persists the durable 'erase' marker — idempotent per active erase (a
 * retry never mints a new generation while one is in flight). Child
 * enqueueing + a bounded inline drain happen after commit; if anything
 * crashes, the scheduled memory-retraction-drainer discovers the marker and
 * self-finalizes.
 *
 * S2 (IAM blast radius): this GraphQL path NEVER performs destructive S3
 * work — the drainer's dedicated IAM role owns the versioned
 * evidence-snapshot deletion. The mutation therefore reports 'pending'
 * until the drainer completes the cleanup phases; 'completed' only after
 * every derivation is retracted, every S3 snapshot VERSION is deleted,
 * evidence rows are scrubbed, and checkpoints are removed. Dead-lettered
 * children surface as 'failed' (operators re-arm via
 * retryMemoryRetractionAttempt).
 *
 * Engines without a `deleteDocument` capability throw a clear error naming
 * the engine (deleteMemoryRecord idiom) before anything is mutated.
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import {
  beginSourceErase,
  runSourceErase,
} from "../../../lib/memory-sources/retraction.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

export async function eraseMemorySource(
  _parent: unknown,
  args: { tenantId?: string | null; sourceConfigId: string },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const { adapter, config } = getMemoryServices();
  if (!adapter.deleteDocument) {
    throw new Error(
      `Memory source erase is not supported on engine "${config.engine}"`,
    );
  }

  // 1. Atomic initiation: disable + fence bump + durable marker, ONE
  //    transaction (throws "Memory source config not found" on a bad id).
  await beginSourceErase(ctx.db, {
    tenantId,
    sourceConfigId: args.sourceConfigId,
  });

  // 2. Run the aggregate: enqueue children, drain a bounded batch inline
  //    (Hindsight deletes — no S3), and report durable status. Destructive
  //    S3 cleanup stays with the drainer (S2).
  const result = await runSourceErase(
    { db: ctx.db, adapter },
    { tenantId, sourceConfigId: args.sourceConfigId },
  );

  return {
    status: result.status,
    attemptsTotal: result.attempts.total,
    attemptsRetracted: result.attempts.retracted,
    attemptsPending: result.attempts.pending,
    attemptsDeadLettered: result.attempts.deadLettered,
    processedThisCall: result.attempts.processedThisCall,
    snapshotObjectsDeleted: result.snapshotObjectsDeleted,
    snapshotVersionsDeleted: result.snapshotVersionsDeleted,
    evidenceRowsCleared: result.evidenceRowsCleared,
    evidenceRowsDeleted: result.evidenceRowsDeleted,
    checkpointsDeleted: result.checkpointsDeleted,
  };
}
