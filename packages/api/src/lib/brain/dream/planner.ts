/**
 * Dream-run planner (THINK-133 U4, KTD-1).
 *
 * Reads a bank's memory units via direct SQL (the adapter exposes no listing
 * endpoint; this mirrors wipe-external-memory-stores.ts) and stages three
 * action classes, applied in this order:
 *
 *   1. quarantine — eval/test residue (evalTraffic-marked or known fixture
 *      patterns). Deleted before consolidation so it can never distill.
 *   2. forget — junk meta-memories (engine chatter like "no contradictions
 *      have been observed") that carry no institutional content.
 *   3. consolidate — one bank-wide `consolidateBankById` call. Merging,
 *      contradiction reconciliation, and decay are Hindsight-native; we
 *      orchestrate, we do not reimplement (KTD-1).
 *
 * Patterns are code-level config constants (KTD-7 spirit): tuned here, no
 * tenant surface.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import type { DreamActionSpec } from "./ledger.js";

/** Synthetic fixture content shapes; must stay in sync with scripts/quarantine-eval-residue.ts. */
export const EVAL_FIXTURE_PATTERN =
  "orbit checksum|UserMarker[0-9a-f]{8}|SpaceMarker[0-9a-f]{8}";

/**
 * Engine/meta chatter with no institutional content. Anchored to whole-text
 * shapes so a real memory that merely mentions contradictions is untouched.
 */
export const JUNK_MEMORY_PATTERN =
  "^(no (new )?(contradictions?|conflicts?|inconsistenc(y|ies))( have| has)?( been)? (observed|detected|found|noted)[.!]?|no new information( was)? (observed|learned|retained)[.!]?)$";

const PLAN_SCAN_LIMIT = 5_000;

export interface BankPlanInput {
  db: Database;
  bankId: string;
}

/** Stage specs for one bank. Deterministic: same bank state → same plan. */
export async function planBankActions(
  args: BankPlanInput,
): Promise<DreamActionSpec[]> {
  const actions: DreamActionSpec[] = [];
  let ordinal = 0;

  const quarantine = await args.db.execute(sql`
    SELECT id::text AS id, document_id
    FROM hindsight.memory_units
    WHERE bank_id = ${args.bankId}
      AND (
        COALESCE(metadata->>'evalTraffic', '') = 'true'
        OR text ~* ${EVAL_FIXTURE_PATTERN}
      )
    ORDER BY id
    LIMIT ${PLAN_SCAN_LIMIT}
  `);
  const quarantineRows = (quarantine.rows ?? []) as Array<{
    id: string;
    document_id: string | null;
  }>;
  if (quarantineRows.length > 0) {
    actions.push({
      ordinal: ordinal++,
      actionType: "quarantine",
      target: {
        memoryUnitIds: quarantineRows.map((row) => row.id),
        documentIds: [
          ...new Set(
            quarantineRows
              .map((row) => row.document_id)
              .filter((id): id is string => !!id),
          ),
        ],
      },
      reason: `eval/test residue: ${quarantineRows.length} unit(s) marked evalTraffic or matching fixture patterns`,
    });
  }

  const junk = await args.db.execute(sql`
    SELECT id::text AS id
    FROM hindsight.memory_units
    WHERE bank_id = ${args.bankId}
      AND btrim(text) ~* ${JUNK_MEMORY_PATTERN}
    ORDER BY id
    LIMIT ${PLAN_SCAN_LIMIT}
  `);
  const junkRows = (junk.rows ?? []) as Array<{ id: string }>;
  if (junkRows.length > 0) {
    actions.push({
      ordinal: ordinal++,
      actionType: "forget",
      target: { memoryUnitIds: junkRows.map((row) => row.id) },
      reason: `junk meta-memories: ${junkRows.length} unit(s) matching engine-chatter patterns`,
    });
  }

  actions.push({
    ordinal: ordinal++,
    actionType: "consolidate",
    target: null,
    reason:
      "Hindsight-native bank consolidation (dedupe, contradiction reconciliation, decay)",
  });

  return actions;
}
