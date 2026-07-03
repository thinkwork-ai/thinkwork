/**
 * Dream-state orchestrator (THINK-133 U4).
 *
 * Per tenant, per bank: resume any unfinished run first (its staged actions
 * apply exactly once), else create a fresh run (dedupe-key guarded), plan,
 * stage, apply. Distillation is NOT invoked here — the existing
 * knowledge-graph observations-ingest schedule consumes the cleaned
 * observations via its own cursors (plan lifecycle: Mark → Distill happens
 * downstream on its own cadence).
 */

import { sql } from "drizzle-orm";
import type { Database } from "@thinkwork/database-pg";
import { applyDreamRun, type DreamConsolidator } from "./applier.js";
import {
  createDreamRun,
  findResumableRun,
  stageDreamActions,
} from "./ledger.js";
import { planBankActions } from "./planner.js";

export interface BrainDreamStateInput {
  tenantId?: string;
  bankId?: string;
  dryRun?: boolean;
  now?: string;
}

export interface BankRunSummary {
  tenantId: string;
  bankId: string;
  runId: string | null;
  status: "applied" | "resumed_applied" | "skipped_dedupe" | "failed" | "dry_run";
  planned?: number;
  applied?: number;
  skipped?: number;
  error?: string;
}

export interface BrainDreamStateResult {
  ok: boolean;
  banks: BankRunSummary[];
}

const MAX_BANKS_PER_RUN = 200;

/**
 * Banks for a tenant: user_<uuid> for tenant users plus space_<uuid> for
 * tenant spaces, restricted to banks that actually hold memory units.
 */
export async function enumerateDreamBanks(
  db: Database,
  tenantId: string,
): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT b.bank_id
    FROM (
      SELECT 'user_' || id::text AS bank_id FROM users WHERE tenant_id = ${tenantId}
      UNION ALL
      SELECT 'space_' || id::text AS bank_id FROM spaces WHERE tenant_id = ${tenantId}
    ) b
    WHERE EXISTS (
      SELECT 1 FROM hindsight.memory_units u WHERE u.bank_id = b.bank_id
    )
    ORDER BY b.bank_id
    LIMIT ${MAX_BANKS_PER_RUN}
  `);
  return ((result.rows ?? []) as Array<{ bank_id: string }>).map(
    (row) => row.bank_id,
  );
}

async function enumerateTenants(db: Database): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT id::text AS id FROM tenants ORDER BY created_at ASC LIMIT 100
  `);
  return ((result.rows ?? []) as Array<{ id: string }>).map((row) => row.id);
}

export async function runBrainDreamState(args: {
  db: Database;
  consolidator: DreamConsolidator;
  input: BrainDreamStateInput;
}): Promise<BrainDreamStateResult> {
  const { db, consolidator, input } = args;
  const now = input.now ? new Date(input.now) : new Date();
  const tenantIds = input.tenantId
    ? [input.tenantId]
    : await enumerateTenants(db);

  const banks: BankRunSummary[] = [];
  for (const tenantId of tenantIds) {
    const bankIds = input.bankId
      ? [input.bankId]
      : await enumerateDreamBanks(db, tenantId);
    for (const bankId of bankIds) {
      banks.push(
        await runBankDream({ db, consolidator, tenantId, bankId, now, dryRun: input.dryRun === true }),
      );
    }
  }

  return { ok: banks.every((bank) => bank.status !== "failed"), banks };
}

async function runBankDream(args: {
  db: Database;
  consolidator: DreamConsolidator;
  tenantId: string;
  bankId: string;
  now: Date;
  dryRun: boolean;
}): Promise<BankRunSummary> {
  const { db, consolidator, tenantId, bankId, now, dryRun } = args;
  try {
    if (dryRun) {
      const plan = await planBankActions({ db, bankId });
      return {
        tenantId,
        bankId,
        runId: null,
        status: "dry_run",
        planned: plan.length,
      };
    }

    // Crash-safety: an unfinished run's staged actions apply exactly once
    // before any new plan is drawn up.
    const resumable = await findResumableRun(db, tenantId, bankId);
    if (resumable) {
      const result = await applyDreamRun({
        db,
        consolidator,
        runId: resumable.id,
        bankId,
      });
      return {
        tenantId,
        bankId,
        runId: resumable.id,
        status: result.failed ? "failed" : "resumed_applied",
        applied: result.applied,
        skipped: result.skipped,
      };
    }

    const run = await createDreamRun({ db, tenantId, bankId, now });
    if (!run) {
      return { tenantId, bankId, runId: null, status: "skipped_dedupe" };
    }
    const plan = await planBankActions({ db, bankId });
    await stageDreamActions(db, run.id, plan);
    const result = await applyDreamRun({
      db,
      consolidator,
      runId: run.id,
      bankId,
    });
    return {
      tenantId,
      bankId,
      runId: run.id,
      status: result.failed ? "failed" : "applied",
      planned: plan.length,
      applied: result.applied,
      skipped: result.skipped,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[brain-dream] bank run failed tenant=${tenantId} bank=${bankId}: ${message}`,
    );
    return { tenantId, bankId, runId: null, status: "failed", error: message };
  }
}
