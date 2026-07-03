#!/usr/bin/env -S tsx
/**
 * One-time quarantine backfill for eval/test residue in Hindsight banks.
 *
 * Plan: docs/plans/2026-07-03-001-feat-thinkwork-brain-memory-architecture-plan.md (U3, AE4)
 *
 * Going forward, eval traffic is stamped at the source (`evalTraffic`
 * metadata; retain is suppressed for eval_mode invocations) — this script
 * cleans up residue that landed BEFORE the stamp existed. Two predicates:
 *   1. metadata->>'evalTraffic' = 'true'  (anything stamped but retained
 *      via a bypass path)
 *   2. known synthetic fixture patterns from the retain→recall smoke and
 *      eval harness ("orbit checksum" / UserMarker / SpaceMarker content)
 *
 * Deletes matching hindsight.memory_units rows, then hindsight.documents
 * rows whose original_text matches the fixture patterns, and strips
 * fixture lines that the high-confidence-fact path projected into
 * user_profiles.notes / user_profiles.family.
 *
 * Mirrors the safety rails of wipe-external-memory-stores.ts: dry-run by
 * default, per-bank breakdown, implausibly-large guard, optional scoping.
 *
 * Usage:
 *   # Dry-run (default): print per-bank counts, no DELETE
 *   DATABASE_URL=... tsx packages/api/scripts/quarantine-eval-residue.ts --stage dev
 *
 *   # Live run
 *   DATABASE_URL=... tsx packages/api/scripts/quarantine-eval-residue.ts \
 *     --stage dev --dry-run=false
 *
 *   # Scope to one bank
 *   DATABASE_URL=... tsx packages/api/scripts/quarantine-eval-residue.ts \
 *     --stage dev --bank user_<uuid>
 */

import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

export interface CliArgs {
  stage: string;
  dryRun: boolean;
  bankId?: string;
  maxDeletes: number;
}

export const DEFAULT_MAX_DELETES = 10_000;

/**
 * Known synthetic fixture content shapes. Case-insensitive POSIX regex,
 * applied to memory_units.text and documents.original_text. Deliberately
 * narrow: these strings are generated markers that cannot occur in real
 * conversation ("orbit checksum <hex>", "UserMarker<hex>", "SpaceMarker<hex>").
 */
export const FIXTURE_PATTERN = "orbit checksum|UserMarker[0-9a-f]{8}|SpaceMarker[0-9a-f]{8}";

function bankScope(bankId?: string): SQL {
  return bankId ? sql`AND bank_id = ${bankId}` : sql``;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    stage: "",
    dryRun: true,
    maxDeletes: DEFAULT_MAX_DELETES,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--stage":
        args.stage = argv[++i] ?? "";
        break;
      case "--dry-run":
      case "--dry-run=true":
        args.dryRun = true;
        break;
      case "--dry-run=false":
        args.dryRun = false;
        break;
      case "--bank":
        args.bankId = argv[++i];
        break;
      case "--max-deletes":
        args.maxDeletes = parseInt(argv[++i] ?? "0", 10);
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: quarantine-eval-residue --stage <dev|prod> [--dry-run=false] [--bank <bank_id>] [--max-deletes <n>]",
        );
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.stage) throw new Error("--stage is required");
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  const survey = await db.execute(sql`
    SELECT bank_id, count(*)::int AS units
    FROM hindsight.memory_units
    WHERE (
      COALESCE(metadata->>'evalTraffic', '') = 'true'
      OR text ~* ${FIXTURE_PATTERN}
    )
    ${bankScope(args.bankId)}
    GROUP BY bank_id
    ORDER BY units DESC
  `);
  const rows = (survey.rows ?? []) as Array<{ bank_id: string; units: number }>;
  const totalUnits = rows.reduce((sum, row) => sum + row.units, 0);

  const docSurvey = await db.execute(sql`
    SELECT count(*)::int AS docs
    FROM hindsight.documents
    WHERE original_text ~* ${FIXTURE_PATTERN}
    ${bankScope(args.bankId)}
  `);
  const totalDocs =
    ((docSurvey.rows ?? [])[0] as { docs?: number } | undefined)?.docs ?? 0;

  console.log(`[quarantine-eval-residue] stage=${args.stage} dryRun=${args.dryRun}`);
  console.log(`  matched memory_units: ${totalUnits}`);
  for (const row of rows) {
    console.log(`    ${row.bank_id}: ${row.units}`);
  }
  console.log(`  matched documents: ${totalDocs}`);

  if (totalUnits + totalDocs > args.maxDeletes) {
    throw new Error(
      `matched ${totalUnits + totalDocs} rows > --max-deletes ${args.maxDeletes}; refusing`,
    );
  }
  if (args.dryRun) {
    console.log("  dry-run: no deletes performed (pass --dry-run=false to apply)");
    return;
  }

  const deletedUnits = await db.execute(sql`
    DELETE FROM hindsight.memory_units
    WHERE (
      COALESCE(metadata->>'evalTraffic', '') = 'true'
      OR text ~* ${FIXTURE_PATTERN}
    )
    ${bankScope(args.bankId)}
    RETURNING id
  `);
  const deletedDocs = await db.execute(sql`
    DELETE FROM hindsight.documents
    WHERE original_text ~* ${FIXTURE_PATTERN}
    ${bankScope(args.bankId)}
    RETURNING id
  `);
  const cleanedProfiles = await db.execute(sql`
    UPDATE user_profiles
    SET
      notes = NULLIF(btrim(regexp_replace(COALESCE(notes, ''), '(^|\n)[^\n]*(orbit checksum)[^\n]*', '', 'gi')), ''),
      family = NULLIF(btrim(regexp_replace(COALESCE(family, ''), '(^|\n)[^\n]*(orbit checksum)[^\n]*', '', 'gi')), ''),
      updated_at = now()
    WHERE COALESCE(notes, '') ~* 'orbit checksum'
       OR COALESCE(family, '') ~* 'orbit checksum'
    RETURNING user_id
  `);

  console.log(
    `  deleted: memory_units=${deletedUnits.rows?.length ?? 0} documents=${deletedDocs.rows?.length ?? 0} user_profiles_cleaned=${cleanedProfiles.rows?.length ?? 0}`,
  );
}

const isDirectRun =
  process.argv[1]?.endsWith("quarantine-eval-residue.ts") === true;
if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
