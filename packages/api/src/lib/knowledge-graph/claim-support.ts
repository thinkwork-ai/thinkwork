/**
 * Out-of-band claim-support resolution for observation packets (THINK-193 U4).
 *
 * DESIGN FACT (probed live on dev, 2026-07-12): Hindsight-synthesized
 * observations (fact_type='observation') carry NO document linkage and empty
 * metadata — claim markers embedded in retained documents do NOT survive
 * synthesis. World-type units DO carry `document_id` = the stable external
 * derivation document id. Claim support therefore joins out-of-band:
 *
 *   observation.source_memory_ids (world unit ids, Hindsight)
 *     → memory_units.document_id                 (Hindsight)
 *     → memory_derivations.hindsight_document_id (Aurora)
 *     → memory_derivations.evidence_item_id
 *     → memory_claim_evidence (active)           → claim ids
 *
 * Observations with no document linkage produce an empty claim set — the
 * packet still flows (enrichment prose); the durable claim ledger, not
 * generated prose, remains authoritative for support/retraction.
 *
 * Do NOT add marker parsing for observations — it structurally cannot work.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { hindsightSql, resolveHindsightDb } from "@thinkwork/database-pg";
import {
  memoryClaimEvidence,
  memoryDerivations,
} from "@thinkwork/database-pg/schema";
import type { Database } from "../db.js";

/** Cap on claim ids carried per observation packet (metadata bloat guard). */
const MAX_CLAIM_IDS_PER_OBSERVATION = 25;

export async function resolveObservationClaimSupport(args: {
  db: Database;
  tenantId: string;
  observations: Array<{ id: string; sourceMemoryIds: string[] }>;
}): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const allUnitIds = [
    ...new Set(
      args.observations.flatMap((observation) => observation.sourceMemoryIds),
    ),
  ];
  if (allUnitIds.length === 0) return result;

  // 1. world units → document ids (Hindsight)
  const hdb = resolveHindsightDb(args.db);
  const unitRows = await hdb.execute(sql`
    SELECT id::text AS id, document_id::text AS document_id
    FROM ${hindsightSql()}memory_units
    WHERE id::text IN (${sql.join(
      allUnitIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND document_id IS NOT NULL
  `);
  const documentIdByUnitId = new Map<string, string>();
  for (const row of (unitRows.rows ?? []) as Array<{
    id: string;
    document_id: string;
  }>) {
    documentIdByUnitId.set(row.id, row.document_id);
  }
  const documentIds = [...new Set(documentIdByUnitId.values())];
  if (documentIds.length === 0) return result;

  // 2. document ids → derivations → evidence items (Aurora)
  const derivationRows = await args.db
    .select({
      hindsight_document_id: memoryDerivations.hindsight_document_id,
      evidence_item_id: memoryDerivations.evidence_item_id,
    })
    .from(memoryDerivations)
    .where(
      and(
        eq(memoryDerivations.tenant_id, args.tenantId),
        inArray(memoryDerivations.hindsight_document_id, documentIds),
      ),
    );
  const evidenceIdsByDocumentId = new Map<string, string[]>();
  for (const row of derivationRows) {
    const list = evidenceIdsByDocumentId.get(row.hindsight_document_id) ?? [];
    list.push(row.evidence_item_id);
    evidenceIdsByDocumentId.set(row.hindsight_document_id, list);
  }
  const allEvidenceIds = [...new Set(derivationRows.map((r) => r.evidence_item_id))];
  if (allEvidenceIds.length === 0) return result;

  // 3. evidence items → active claim support edges (Aurora)
  const supportRows = await args.db
    .select({
      claim_id: memoryClaimEvidence.claim_id,
      evidence_item_id: memoryClaimEvidence.evidence_item_id,
    })
    .from(memoryClaimEvidence)
    .where(
      and(
        eq(memoryClaimEvidence.tenant_id, args.tenantId),
        eq(memoryClaimEvidence.status, "active"),
        inArray(memoryClaimEvidence.evidence_item_id, allEvidenceIds),
      ),
    );
  const claimIdsByEvidenceId = new Map<string, string[]>();
  for (const row of supportRows) {
    const list = claimIdsByEvidenceId.get(row.evidence_item_id) ?? [];
    list.push(row.claim_id);
    claimIdsByEvidenceId.set(row.evidence_item_id, list);
  }

  // 4. fold back per observation
  for (const observation of args.observations) {
    const claimIds = new Set<string>();
    for (const unitId of observation.sourceMemoryIds) {
      const documentId = documentIdByUnitId.get(unitId);
      if (!documentId) continue;
      for (const evidenceId of evidenceIdsByDocumentId.get(documentId) ?? []) {
        for (const claimId of claimIdsByEvidenceId.get(evidenceId) ?? []) {
          claimIds.add(claimId);
          if (claimIds.size >= MAX_CLAIM_IDS_PER_OBSERVATION) break;
        }
        if (claimIds.size >= MAX_CLAIM_IDS_PER_OBSERVATION) break;
      }
      if (claimIds.size >= MAX_CLAIM_IDS_PER_OBSERVATION) break;
    }
    if (claimIds.size > 0) {
      result.set(observation.id, [...claimIds]);
    }
  }
  return result;
}
