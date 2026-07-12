/**
 * eraseMemorySource — disable a source config and erase its footprint
 * (THINK-193 U2): enqueue erase attempts for the source's projections,
 * process each inline sequentially (RequestResponse — errors surface),
 * then purge the source's checkpoints so a re-enable starts from scratch.
 * Returns the number of processed retraction attempts.
 *
 * Engines without a `deleteDocument` capability throw a clear error naming
 * the engine (deleteMemoryRecord idiom) before anything is mutated.
 */

import {
  memoryRetractionAttempts as memoryRetractionAttemptsTable,
  memorySourceCheckpoints as memorySourceCheckpointsTable,
  memorySourceConfigs as memorySourceConfigsTable,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import {
  enqueueSourceErase,
  processRetractionAttempt,
} from "../../../lib/memory-sources/retraction.js";
import { and, eq, notInArray } from "../../utils.js";
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

  // 2. Enqueue erase attempts, then process every non-terminal
  //    source-scoped attempt for this source inline, sequentially — that
  //    covers both freshly enqueued attempts and previously stalled ones.
  //    A failure surfaces immediately (RequestResponse); processed
  //    attempts stay accounted for in the ledger and re-runs are safe.
  await enqueueSourceErase(ctx.db, {
    tenantId,
    sourceConfigId: args.sourceConfigId,
  });
  const pending = await ctx.db
    .select({ id: memoryRetractionAttemptsTable.id })
    .from(memoryRetractionAttemptsTable)
    .where(
      and(
        eq(memoryRetractionAttemptsTable.tenant_id, tenantId),
        eq(memoryRetractionAttemptsTable.source_config_id, args.sourceConfigId),
        eq(memoryRetractionAttemptsTable.scope, "source"),
        notInArray(memoryRetractionAttemptsTable.status, [
          "retracted",
          "dead_lettered",
        ]),
      ),
    );
  let processedCount = 0;
  for (const attempt of pending) {
    await processRetractionAttempt({ db: ctx.db, adapter }, attempt.id);
    processedCount += 1;
  }

  // 3. Purge the source's checkpoints so a future re-enable re-acquires
  //    from the beginning instead of resuming a stale cursor.
  await ctx.db
    .delete(memorySourceCheckpointsTable)
    .where(
      and(
        eq(memorySourceCheckpointsTable.tenant_id, tenantId),
        eq(memorySourceCheckpointsTable.source_config_id, args.sourceConfigId),
      ),
    );

  return processedCount;
}
