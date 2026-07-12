#!/usr/bin/env tsx
/**
 * THINK-263 U1 — backfill thread provenance onto Hindsight memory units.
 *
 * Conversation units (`context = 'thinkwork_thread'`) have always carried the
 * source thread id as `document_id` (retainConversation sets
 * document_id = threadId), so pre-stamp history is recoverable: copy
 * document_id into metadata.threadId wherever the stamp is missing.
 * threadTurnId is not recoverable for old units (never persisted anywhere)
 * and is left absent.
 *
 * Dry-run by default; pass --write to apply. Idempotent: the WHERE clause
 * excludes already-stamped rows. Runs against the Hindsight database
 * (dedicated `thinkwork_hindsight` post-THINK-220, or the `hindsight.` schema
 * pre-cutover) via the shared seam helpers.
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
  const hdb = resolveHindsightDb(getDb());

  const candidates = await hdb.execute(sql`
    SELECT id, document_id
    FROM ${hindsightSql()}memory_units
    WHERE context = 'thinkwork_thread'
      AND document_id IS NOT NULL
      AND document_id <> ''
      AND (metadata IS NULL OR metadata->>'threadId' IS NULL)
    LIMIT ${limit}
  `);
  const rows = Array.from(candidates as Iterable<Record<string, unknown>>);

  if (!write) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          limit,
          candidates: rows.length,
          sample: rows.slice(0, 5).map((r) => ({
            id: r.id,
            document_id: r.document_id,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const updated = await hdb.execute(sql`
    UPDATE ${hindsightSql()}memory_units
    SET metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object('threadId', document_id)
    WHERE id IN (
      SELECT id
      FROM ${hindsightSql()}memory_units
      WHERE context = 'thinkwork_thread'
        AND document_id IS NOT NULL
        AND document_id <> ''
        AND (metadata IS NULL OR metadata->>'threadId' IS NULL)
      LIMIT ${limit}
    )
  `);

  console.log(
    JSON.stringify(
      {
        mode: "write",
        limit,
        candidates: rows.length,
        updated: (updated as { rowCount?: number }).rowCount ?? rows.length,
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
