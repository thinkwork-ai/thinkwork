/**
 * eraseMemorySource — disable a source config and erase its footprint
 * (THINK-193 U2, Codex P1 #4): the erase is a durable AGGREGATE over the
 * per-document retraction saga. It only reports "completed" after every
 * derivation is retracted, every S3 evidence-snapshot object under the
 * source's prefix is deleted, snapshot payloads are cleared and non-derived
 * evidence rows removed, and — only then — checkpoints are purged. Partial
 * progress returns status "pending" and SELF-FINALIZES: the scheduled
 * memory-retraction-drainer keeps retracting the children and runs the
 * cleanup phase itself once they are all terminal — a second mutation is
 * never required. Dead-lettered children return status "failed". Never a
 * bare success integer.
 *
 * Engines without a `deleteDocument` capability throw a clear error naming
 * the engine (deleteMemoryRecord idiom) before anything is mutated.
 */

import { memorySourceConfigs as memorySourceConfigsTable } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { runSourceErase } from "../../../lib/memory-sources/retraction.js";
import { and, eq } from "../../utils.js";
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

  const sourceFilter = and(
    eq(memorySourceConfigsTable.id, args.sourceConfigId),
    eq(memorySourceConfigsTable.tenant_id, tenantId),
  );
  const [source] = await ctx.db
    .select()
    .from(memorySourceConfigsTable)
    .where(sourceFilter)
    .limit(1);
  if (!source) throw new Error("Memory source config not found");

  // 1. Disable the source so no new acquisition runs pick it up.
  await ctx.db
    .update(memorySourceConfigsTable)
    .set({ enabled: false, updated_at: new Date() })
    .where(sourceFilter);

  // 2. Run the erase aggregate (enqueue + bounded inline saga drain +
  //    conditional cleanup). RequestResponse: errors surface to the caller.
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
    evidenceRowsCleared: result.evidenceRowsCleared,
    evidenceRowsDeleted: result.evidenceRowsDeleted,
    checkpointsDeleted: result.checkpointsDeleted,
  };
}
