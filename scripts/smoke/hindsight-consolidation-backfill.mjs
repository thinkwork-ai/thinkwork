#!/usr/bin/env node
/**
 * One-shot, re-runnable consolidation backfill for Hindsight banks.
 *
 * Banks created before the observation mission landed hold months of retained
 * facts that were never consolidated. This sweep POSTs `/consolidate` (empty
 * body = process all unconsolidated memories) to every bank — primary
 * `user_<uuid>` banks AND legacy agent-derived banks — so the historical
 * corpus synthesizes observations.
 *
 * Dry-run is the default: lists the banks it would consolidate and exits.
 * Set SMOKE_ENABLE_HINDSIGHT_BACKFILL=1 to run the live sweep.
 *
 * Required (live mode):
 *   HINDSIGHT_ENDPOINT   Hindsight HTTP endpoint (internal ALB — run from a
 *                        network position that can reach it)
 *   DATABASE_URL         Aurora connection string (bank enumeration via
 *                        hindsight.banks)
 *
 * Optional:
 *   SMOKE_BANK_LIMIT     cap the number of banks swept (default: all)
 *   SMOKE_BANK_ID        consolidate exactly one bank id
 *
 * A 4xx/5xx on one bank logs and continues — the sweep never aborts on a
 * single bank failure. Re-running is safe: consolidation is incremental over
 * unconsolidated memories.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

const LIVE = process.env.SMOKE_ENABLE_HINDSIGHT_BACKFILL === "1";
const ENDPOINT = (process.env.HINDSIGHT_ENDPOINT || "").replace(/\/$/, "");
const DATABASE_URL = process.env.DATABASE_URL || "";
const BANK_LIMIT = Number(process.env.SMOKE_BANK_LIMIT || 0);
const SINGLE_BANK = process.env.SMOKE_BANK_ID || "";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 120_000);

function fail(message) {
  console.error(`hindsight-consolidation-backfill: ${message}`);
  process.exit(1);
}

function listBanks() {
  if (SINGLE_BANK) return [SINGLE_BANK];
  if (!DATABASE_URL) {
    fail("DATABASE_URL is required to enumerate banks (or set SMOKE_BANK_ID)");
  }
  const out = execFileSync(
    "psql",
    [DATABASE_URL, "-tAc", "SELECT bank_id FROM hindsight.banks ORDER BY bank_id"],
    { encoding: "utf8" },
  );
  const banks = out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return BANK_LIMIT > 0 ? banks.slice(0, BANK_LIMIT) : banks;
}

async function consolidate(bankId) {
  const url = `${ENDPOINT}/v1/default/banks/${encodeURIComponent(bankId)}/consolidate`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${resp.status}: ${body.slice(0, 200)}`);
  }
}

const banks = listBanks();
console.log(
  `hindsight-consolidation-backfill: ${banks.length} bank(s) ${LIVE ? "to consolidate" : "would be consolidated (dry-run)"}`,
);
for (const bank of banks) console.log(`  ${bank}`);

if (!LIVE) {
  console.log(
    "Dry-run complete. Set SMOKE_ENABLE_HINDSIGHT_BACKFILL=1 to run the sweep.",
  );
  process.exit(0);
}

if (!ENDPOINT) fail("HINDSIGHT_ENDPOINT is required in live mode");

let ok = 0;
let failed = 0;
for (const bank of banks) {
  try {
    await consolidate(bank);
    ok += 1;
    console.log(`consolidated ${bank}`);
  } catch (err) {
    failed += 1;
    console.warn(`FAILED ${bank}: ${err?.message ?? err}`);
  }
}
console.log(
  `hindsight-consolidation-backfill: done ok=${ok} failed=${failed} total=${banks.length}`,
);
process.exit(failed > 0 && ok === 0 ? 1 : 0);
