import DataLoader from "dataloader";
import { and, inArray } from "drizzle-orm";
import { retryQueue } from "@thinkwork/database-pg/schema";
import { db } from "../../utils.js";

/**
 * Key for ThreadTurn.recoveryPending (THINK-301 U6, KTD-A). tenantId is the
 * parent turn's tenant, used as a belt-and-suspenders filter (mirrors the
 * tenant scoping pattern in threads/types.ts); null falls back to trusting
 * the upstream tenant gate on the ThreadTurn fetch.
 */
export interface RecoveryPendingKey {
  turnId: string;
  tenantId: string | null;
}

/** retry_queue statuses that count as recovery-in-flight (parent R1). */
const OPEN_RETRY_STATUSES = ["pending", "dispatched"];

export const createTriggerLoaders = () => ({
  /**
   * ThreadTurn.recoveryPending — true iff a retry_queue row with
   * origin_turn_id = the turn's id exists in status pending|dispatched.
   * One batched query per request regardless of turn count (uses
   * idx_retry_queue_origin_turn). Terminal rows (succeeded/superseded/
   * exhausted) never count; a turn with no rows resolves false.
   *
   * Best-effort (mirrors the threadPendingUserQuestion probe): a stage
   * whose retry_queue migration is missing degrades to false instead of
   * failing every turn query.
   */
  threadTurnRecoveryPending: new DataLoader<
    RecoveryPendingKey,
    boolean,
    string
  >(
    async (keys) => {
      const turnIds = [...new Set(keys.map((key) => key.turnId))];
      if (turnIds.length === 0) return [];
      const openTenantsByTurn = new Map<string, Set<string>>();
      try {
        const rows = await db
          .select({
            origin_turn_id: retryQueue.origin_turn_id,
            tenant_id: retryQueue.tenant_id,
          })
          .from(retryQueue)
          .where(
            and(
              inArray(retryQueue.origin_turn_id, turnIds),
              inArray(retryQueue.status, OPEN_RETRY_STATUSES),
            ),
          );
        for (const row of rows) {
          if (!row.origin_turn_id) continue;
          const bucket =
            openTenantsByTurn.get(row.origin_turn_id) ?? new Set<string>();
          bucket.add(row.tenant_id);
          openTenantsByTurn.set(row.origin_turn_id, bucket);
        }
      } catch (err) {
        console.error("[threadTurnRecoveryPending] probe failed:", err);
      }
      return keys.map((key) => {
        const tenants = openTenantsByTurn.get(key.turnId);
        if (!tenants || tenants.size === 0) return false;
        return key.tenantId == null || tenants.has(key.tenantId);
      });
    },
    { cacheKeyFn: (key) => `${key.tenantId ?? ""}|${key.turnId}` },
  ),
});
