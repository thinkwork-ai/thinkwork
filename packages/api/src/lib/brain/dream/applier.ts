/**
 * Dream-run applier (THINK-133 U4, KTD-1/KTD-2).
 *
 * Executes only `staged` ledger actions, marking each applied as it lands —
 * a crashed run re-applies exactly the rows that never got their marker.
 * Deletes are direct SQL on hindsight.* (same pattern as memory-retain.ts's
 * document-scoped deletes); consolidation is the Hindsight-native HTTP call.
 *
 * Forgetting is real (R6): quarantined and junk units are deleted, and
 * quarantined documents whose units are all gone are deleted too.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import {
  completeDreamRun,
  failDreamRun,
  loadStagedActions,
  markActionApplied,
  markActionSkipped,
  markRunApplying,
  type StagedActionRow,
} from "./ledger.js";

export interface DreamConsolidator {
  consolidateBankById(bankId: string): Promise<void>;
}

export interface ApplyDreamRunResult {
  applied: number;
  skipped: number;
  failed: boolean;
}

export async function applyDreamRun(args: {
  db: Database;
  consolidator: DreamConsolidator;
  runId: string;
  bankId: string;
}): Promise<ApplyDreamRunResult> {
  const { db, consolidator, runId, bankId } = args;
  await markRunApplying(db, runId);
  const staged = await loadStagedActions(db, runId);
  let applied = 0;
  let skipped = 0;

  for (const action of staged) {
    try {
      await applyAction(db, consolidator, bankId, action);
      await markActionApplied(db, action.id);
      applied += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Consolidation failure fails the run (it is the whole point); a
      // delete failure on one action is recorded and the run continues.
      if (action.action_type === "consolidate") {
        await failDreamRun(db, runId, message);
        return { applied, skipped, failed: true };
      }
      await markActionSkipped(db, action.id, message.slice(0, 500));
      skipped += 1;
    }
  }

  await completeDreamRun(db, runId);
  return { applied, skipped, failed: false };
}

async function applyAction(
  db: Database,
  consolidator: DreamConsolidator,
  bankId: string,
  action: StagedActionRow,
): Promise<void> {
  switch (action.action_type) {
    case "quarantine": {
      const unitIds = action.target?.memoryUnitIds ?? [];
      const documentIds = action.target?.documentIds ?? [];
      if (unitIds.length > 0) {
        await db.execute(sql`
          DELETE FROM hindsight.memory_units
          WHERE bank_id = ${bankId}
            AND id IN (SELECT unnest(${unitIds}::uuid[]))
        `);
      }
      if (documentIds.length > 0) {
        // Remove quarantined documents only once no other units reference them.
        await db.execute(sql`
          DELETE FROM hindsight.documents d
          WHERE d.bank_id = ${bankId}
            AND d.id IN (SELECT unnest(${documentIds}::varchar[]))
            AND NOT EXISTS (
              SELECT 1 FROM hindsight.memory_units u
              WHERE u.bank_id = d.bank_id AND u.document_id = d.id
            )
        `);
      }
      return;
    }
    case "forget": {
      const unitIds = action.target?.memoryUnitIds ?? [];
      if (unitIds.length > 0) {
        await db.execute(sql`
          DELETE FROM hindsight.memory_units
          WHERE bank_id = ${bankId}
            AND id IN (SELECT unnest(${unitIds}::uuid[]))
        `);
      }
      return;
    }
    case "consolidate": {
      await consolidator.consolidateBankById(bankId);
      return;
    }
    default: {
      throw new Error(`unknown dream action type: ${action.action_type}`);
    }
  }
}
