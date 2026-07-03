/**
 * Scheduled Lambda — the Brain "dream state" (THINK-133 U4).
 *
 * Recurring background consolidation over each tenant's Hindsight banks:
 * quarantines eval residue, forgets junk meta-memories, and drives
 * Hindsight-native consolidation — all through the brain_dream_runs audit
 * ledger (staged plan → atomic apply → applied markers), so a crashed or
 * retried invocation resumes without double-deleting (KTD-2).
 *
 * Env-gated like requester-memory-dreaming: inert unless
 * BRAIN_DREAM_STATE_ENABLED === "true" or the event carries `manual: true`
 * (operator invoke for dev validation while the schedule stays disabled).
 *
 * Scheduler wiring uses maximum_retry_attempts = 0 + DLQ — retries are the
 * ledger's job, not Lambda's.
 */

import { getDb } from "@thinkwork/database-pg";
import { getMemoryServices } from "../lib/memory/index.js";
import {
  runBrainDreamState,
  type BrainDreamStateInput,
  type BrainDreamStateResult,
} from "../lib/brain/dream/runner.js";

export type BrainDreamStateEvent = BrainDreamStateInput & {
  manual?: boolean;
};

export async function handler(
  event: BrainDreamStateEvent = {},
): Promise<BrainDreamStateResult & { enabled: boolean }> {
  const enabled =
    process.env.BRAIN_DREAM_STATE_ENABLED === "true" || event.manual === true;
  if (!enabled) {
    return { ok: true, enabled: false, banks: [] };
  }

  const { adapter, config } = getMemoryServices();
  if (config.engine !== "hindsight" || !adapter.consolidateBankById) {
    console.warn(
      `[brain-dream] engine=${config.engine} has no consolidateBankById; skipping`,
    );
    return { ok: true, enabled: true, banks: [] };
  }

  const result = await runBrainDreamState({
    db: getDb(),
    consolidator: {
      consolidateBankById: (bankId: string) =>
        adapter.consolidateBankById!(bankId),
    },
    input: {
      tenantId: event.tenantId,
      bankId: event.bankId,
      dryRun: event.dryRun,
      now: event.now,
    },
  });

  console.log(
    `[brain-dream] processed=${result.banks.length} ` +
      `applied=${result.banks.filter((b) => b.status === "applied" || b.status === "resumed_applied").length} ` +
      `failed=${result.banks.filter((b) => b.status === "failed").length}`,
  );
  return { ...result, enabled: true };
}
