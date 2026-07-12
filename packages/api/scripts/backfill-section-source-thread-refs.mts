#!/usr/bin/env tsx
/**
 * THINK-263 U2 — backfill thread backpointers onto wiki.section_sources.
 *
 * For rows with source_kind='memory_unit' and no source_thread_ids, resolve
 * the cited Hindsight unit and copy its thread provenance: the unit's
 * stamped metadata.threadId (U1), else document_id for conversation units
 * (context='thinkwork_thread'). Units that no longer exist or carry no
 * thread provenance are skipped (the column stays null — honest absence,
 * never fabricated provenance).
 *
 * Dry-run by default; pass --write to apply. Idempotent: only null-stamped
 * rows are candidates.
 */

import { sql } from "drizzle-orm";
import {
  getDb,
  hindsightSql,
  resolveHindsightDb,
} from "@thinkwork/database-pg";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const limit = Number(
  process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--limit="))
    ?.split("=")[1] ?? 5000,
);

async function main() {
  const db = getDb();
  const hdb = resolveHindsightDb(db);

  const candidates = Array.from(
    (await db.execute(sql`
      SELECT id, source_ref
      FROM wiki.section_sources
      WHERE source_kind = 'memory_unit'
        AND source_thread_ids IS NULL
      LIMIT ${limit}
    `)) as Iterable<{ id: string; source_ref: string }>,
  );

  if (candidates.length === 0) {
    console.log(
      JSON.stringify({ mode: write ? "write" : "dry-run", candidates: 0 }),
    );
    return;
  }

  const refs = Array.from(new Set(candidates.map((c) => c.source_ref)));
  const units = Array.from(
    (await hdb.execute(sql`
      SELECT id::text AS id,
             COALESCE(metadata->>'threadId',
                      CASE WHEN context = 'thinkwork_thread' THEN document_id END
             ) AS thread_id
      FROM ${hindsightSql()}memory_units
      WHERE id::text IN (${sql.join(
        refs.map((r) => sql`${r}`),
        sql`, `,
      )})
    `)) as Iterable<{ id: string; thread_id: string | null }>,
  );
  const threadByUnit = new Map(
    units.filter((u) => u.thread_id).map((u) => [u.id, u.thread_id as string]),
  );

  let updated = 0;
  let skipped = 0;
  for (const row of candidates) {
    const threadId = threadByUnit.get(row.source_ref);
    if (!threadId) {
      skipped += 1;
      continue;
    }
    if (write) {
      await db.execute(sql`
        UPDATE wiki.section_sources
        SET source_thread_ids = ARRAY[${threadId}]::text[]
        WHERE id = ${row.id} AND source_thread_ids IS NULL
      `);
    }
    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        limit,
        candidates: candidates.length,
        resolvable: updated,
        unresolvable: skipped,
      },
      null,
      2,
    ),
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
