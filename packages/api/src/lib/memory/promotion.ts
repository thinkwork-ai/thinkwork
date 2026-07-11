/**
 * Governed Promotion (THINK-261 / company-brain plan U10) — copy explicitly
 * selected space-bank memories into the tenant's company-scope Tenant Bank.
 *
 * Mechanics per plan KTD-6, validated by the 2026-07-11 spike
 * (docs/solutions/tooling-decisions/hindsight-mental-models-spike-verdict-2026-07-11.md):
 * promotion is a verbatim `memory_units` copy (embedding included) via direct
 * SQL — never the HTTP retain path, whose vendor-side LLM extraction can
 * rewrite or split content. The copy carries provenance in metadata
 * (`sourceBankId`, `sourceMemoryId`, `sourceTimestamp`, `promotedBy`,
 * `promotedAt`, `justification`) and keeps the original `created_at`, so the
 * Tenant Bank stays auditable and re-derivable. Idempotent per
 * (sourceBankId, sourceMemoryId); parent `documents` rows are copied first
 * (the units FK is bank-scoped). Source rows are untouched — promotion never
 * hollows out the team bank.
 */

import { sql } from "drizzle-orm";
import { getDb, getHindsightDb, hindsightSql } from "@thinkwork/database-pg";
import { activityLog } from "@thinkwork/database-pg/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PromoteSpaceMemoriesArgs {
  tenantId: string;
  spaceId: string;
  memoryIds: string[];
  justification: string;
  actorId: string;
}

export interface PromoteSpaceMemoriesResult {
  promoted: string[];
  alreadyPromoted: string[];
  missing: string[];
}

export async function promoteSpaceMemoriesToTenant(
  args: PromoteSpaceMemoriesArgs,
): Promise<PromoteSpaceMemoriesResult> {
  if (!args.justification.trim()) {
    throw new Error("Governed Promotion requires a justification");
  }
  const memoryIds = [...new Set(args.memoryIds.map((id) => id.trim()))].filter(
    Boolean,
  );
  if (memoryIds.length === 0) {
    throw new Error("Governed Promotion requires at least one memory id");
  }
  if (memoryIds.length > 100) {
    throw new Error("Governed Promotion is capped at 100 memories per call");
  }
  for (const id of memoryIds) {
    if (!UUID_RE.test(id)) {
      throw new Error(`memory id is not a UUID: ${id}`);
    }
  }
  if (!UUID_RE.test(args.tenantId) || !UUID_RE.test(args.spaceId)) {
    throw new Error("tenantId and spaceId must be UUIDs");
  }

  const sourceBankId = `space_${args.spaceId}`;
  const tenantBankId = `tenant_${args.tenantId}`;
  const db = getHindsightDb();
  const idList = sql.join(
    memoryIds.map((id) => sql`${id}`),
    sql`, `,
  );

  // Which of the requested ids exist in the source space bank at all?
  const sourceRows = (await db.execute(sql`
    SELECT id::text AS id FROM ${hindsightSql()}memory_units
    WHERE bank_id = ${sourceBankId} AND id::text IN (${idList})
  `)) as unknown as { rows?: Array<{ id: string }> };
  const present = new Set((sourceRows.rows ?? []).map((row) => row.id));
  const missing = memoryIds.filter((id) => !present.has(id));

  // Which already have a Tenant Bank copy (idempotency key: sourceMemoryId)?
  const existingRows = (await db.execute(sql`
    SELECT metadata->>'sourceMemoryId' AS source_id
    FROM ${hindsightSql()}memory_units
    WHERE bank_id = ${tenantBankId}
      AND metadata->>'sourceBankId' = ${sourceBankId}
      AND metadata->>'sourceMemoryId' IN (${idList})
  `)) as unknown as { rows?: Array<{ source_id: string }> };
  const alreadyPromoted = (existingRows.rows ?? [])
    .map((row) => row.source_id)
    .filter((id) => present.has(id));
  const alreadySet = new Set(alreadyPromoted);
  const toPromote = memoryIds.filter(
    (id) => present.has(id) && !alreadySet.has(id),
  );

  if (toPromote.length > 0) {
    const promoteList = sql.join(
      toPromote.map((id) => sql`${id}`),
      sql`, `,
    );
    // Ensure the Tenant Bank registry row exists (spike learning: mental
    // models FK onto banks; the retain path normally creates this row).
    await db.execute(sql`
      INSERT INTO ${hindsightSql()}banks (bank_id, name, updated_at)
      VALUES (${tenantBankId}, ${tenantBankId}, now())
      ON CONFLICT (bank_id) DO UPDATE SET updated_at = EXCLUDED.updated_at
    `);
    // Parent documents ride along (bank-scoped FK) so original text stays
    // reachable from the Tenant Bank.
    await db.execute(sql`
      INSERT INTO ${hindsightSql()}documents (
        id, bank_id, original_text, content_hash, created_at, updated_at,
        retain_params, tags
      )
      SELECT d.id, ${tenantBankId}, d.original_text, d.content_hash,
             d.created_at, now(), d.retain_params, d.tags
      FROM ${hindsightSql()}documents d
      WHERE d.bank_id = ${sourceBankId}
        AND d.id IN (
          SELECT document_id FROM ${hindsightSql()}memory_units
          WHERE bank_id = ${sourceBankId}
            AND id::text IN (${promoteList})
            AND document_id IS NOT NULL
        )
      ON CONFLICT (id, bank_id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO ${hindsightSql()}memory_units (
        id, bank_id, document_id, text, embedding, context, event_date,
        occurred_start, occurred_end, mentioned_at, fact_type, access_count,
        metadata, created_at, updated_at, chunk_id, tags, proof_count,
        source_memory_ids, observation_scopes, text_signals
      )
      SELECT gen_random_uuid(), ${tenantBankId}, s.document_id, s.text,
             s.embedding, s.context, s.event_date, s.occurred_start,
             s.occurred_end, s.mentioned_at, s.fact_type, 0,
             COALESCE(s.metadata, '{}'::jsonb) || jsonb_build_object(
               'sourceBankId', s.bank_id,
               'sourceMemoryId', s.id::text,
               'sourceTimestamp', s.created_at::text,
               'promotedBy', ${args.actorId},
               'promotedAt', now()::text,
               'justification', ${args.justification}
             ),
             s.created_at, now(), s.chunk_id, s.tags, s.proof_count,
             s.source_memory_ids, s.observation_scopes, s.text_signals
      FROM ${hindsightSql()}memory_units s
      WHERE s.bank_id = ${sourceBankId}
        AND s.id::text IN (${promoteList})
    `);
    // Audit trail (mirrors lib/brain/promotion.ts): actor + justification on
    // one activity row per promotion call.
    await getDb()
      .insert(activityLog)
      .values({
        tenant_id: args.tenantId,
        actor_type: "user",
        actor_id: args.actorId,
        action: "tenant_memory_promotion",
        entity_type: "hindsight_bank",
        entity_id: args.tenantId,
        metadata: {
          sourceBankId,
          tenantBankId,
          memoryIds: toPromote,
          alreadyPromoted,
          missing,
          justification: args.justification,
        },
      });
  }

  return { promoted: toPromote, alreadyPromoted, missing };
}

export interface TenantBankMemoryRow {
  id: string;
  content: string;
  factType: string | null;
  sourceBankId: string | null;
  sourceMemoryId: string | null;
  sourceTimestamp: string | null;
  promotedBy: string | null;
  promotedAt: string | null;
  justification: string | null;
  accessCount: number | null;
  createdAt: string | null;
}

/**
 * Company-brain plan U11 — "what is in the Tenant Bank and where did each
 * item come from," one query, provenance + consumption signal per unit.
 */
export async function listTenantBankMemories(args: {
  tenantId: string;
  limit?: number;
}): Promise<TenantBankMemoryRow[]> {
  if (!UUID_RE.test(args.tenantId)) {
    throw new Error("tenantId must be a UUID");
  }
  const tenantBankId = `tenant_${args.tenantId}`;
  const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
  const result = (await getHindsightDb().execute(sql`
    SELECT id::text AS id,
           text AS content,
           fact_type,
           metadata->>'sourceBankId' AS source_bank_id,
           metadata->>'sourceMemoryId' AS source_memory_id,
           metadata->>'sourceTimestamp' AS source_timestamp,
           metadata->>'promotedBy' AS promoted_by,
           metadata->>'promotedAt' AS promoted_at,
           metadata->>'justification' AS justification,
           access_count,
           created_at::text AS created_at
    FROM ${hindsightSql()}memory_units
    WHERE bank_id = ${tenantBankId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `)) as unknown as {
    rows?: Array<Record<string, unknown>>;
  };
  return (result.rows ?? []).map((row) => ({
    id: String(row.id),
    content: String(row.content ?? ""),
    factType: (row.fact_type as string | null) ?? null,
    sourceBankId: (row.source_bank_id as string | null) ?? null,
    sourceMemoryId: (row.source_memory_id as string | null) ?? null,
    sourceTimestamp: (row.source_timestamp as string | null) ?? null,
    promotedBy: (row.promoted_by as string | null) ?? null,
    promotedAt: (row.promoted_at as string | null) ?? null,
    justification: (row.justification as string | null) ?? null,
    accessCount:
      typeof row.access_count === "number" ? row.access_count : null,
    createdAt: (row.created_at as string | null) ?? null,
  }));
}
