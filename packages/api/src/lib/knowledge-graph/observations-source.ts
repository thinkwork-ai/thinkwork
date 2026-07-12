/**
 * Observations ingest source — tenant fan-in over per-user Hindsight banks.
 *
 * Reads engine-synthesized observations (provenance = populated
 * `source_memory_ids`; user-postable `fact_type` alone is forgeable via
 * mobile capture and is never trusted) from every user bank in the tenant,
 * incrementally via per-(tenant, bank) cursors with the same
 * `(updated_at, id)` tiebreaker discipline as the wiki compile cursor.
 * Legacy agent-derived banks are deliberately excluded from fan-in — their
 * content predates the per-user model (plan U2 disposition).
 *
 * Candidates flow through the layered promotion gate
 * (observation-promotion-gate.ts) before becoming a source bundle; the run's
 * audit carries every verdict. Cursors returned here are NOT persisted by
 * the loader — the U5 worker advances them inside the same transaction that
 * replaces the mirror snapshot.
 */

import { sql } from "drizzle-orm";
import { hindsightSql, resolveHindsightDb } from "@thinkwork/database-pg";
import type { Database } from "../db.js";
import { resolveObservationClaimSupport } from "./claim-support.js";
import {
  applyPromotionGate,
  type GateCandidate,
  type GateResult,
  type PromotionGateDeps,
} from "./observation-promotion-gate.js";
import {
  renderPacketDocument,
  type KnowledgeGraphSourceBundle,
  type KnowledgeGraphSourcePacket,
} from "./source-adapters.js";

const PAGE_SIZE = 200;
/** Per-run candidate cap so backlog recovery chunks across runs (plan U5). */
const DEFAULT_MAX_CANDIDATES_PER_RUN = 500;

export interface ObservationCursor {
  updatedAt: Date | null;
  recordId: string | null;
}

export interface ObservationCandidateBatch {
  candidates: GateCandidate[];
  /** Next cursor per bank — persisted by the worker on success only. */
  nextCursors: Map<string, ObservationCursor>;
  /** True when a bank hit the per-run cap and has more rows waiting. */
  truncated: boolean;
}

/**
 * Validate an explicit bank list for targeted ingest (THINK-193 U4).
 * Shared banks only: `space_*` and `tenant_*` are allowed; `user_*` (and
 * anything else) is rejected — a shared run must never read personal banks.
 * The enumerate-users fan-in below remains the scheduled estate-sweep
 * backstop when no explicit list is supplied.
 */
export function validateExplicitBankIds(
  bankIds: string[],
): Array<{ bankId: string; userId: null }> {
  const seen = new Set<string>();
  const banks: Array<{ bankId: string; userId: null }> = [];
  for (const bankId of bankIds) {
    if (!/^(space|tenant)_[A-Za-z0-9_-]+$/.test(bankId)) {
      throw new Error(
        `Explicit observations ingest bank '${bankId}' is not allowed: ` +
          "only shared 'space_*' / 'tenant_*' banks may be targeted " +
          "(user_* banks are personal and flow only through the estate sweep)",
      );
    }
    if (seen.has(bankId)) continue;
    seen.add(bankId);
    banks.push({ bankId, userId: null });
  }
  return banks;
}

/** Tenant fan-in: one `user_<uuid>` bank per active tenant user. */
export async function enumerateTenantBanks(
  db: Database,
  tenantId: string,
): Promise<Array<{ bankId: string; userId: string }>> {
  const result = await db.execute(sql`
		SELECT id::text AS id
		FROM users
		WHERE tenant_id = ${tenantId}
		ORDER BY id
	`);
  return ((result.rows ?? []) as Array<{ id: string }>).map((row) => ({
    bankId: `user_${row.id}`,
    userId: row.id,
  }));
}

/**
 * Read new/updated engine observations for one bank, paginated past the
 * SQL page cap so a fresh cursor (epoch) drains fully across calls.
 */
async function readBankObservations(args: {
  db: Database;
  bankId: string;
  userId: string | null;
  cursor: ObservationCursor;
  limit: number;
}): Promise<{
  candidates: GateCandidate[];
  nextCursor: ObservationCursor;
  drained: boolean;
}> {
  const candidates: GateCandidate[] = [];
  let cursorTs = args.cursor.updatedAt ?? new Date(0);
  let cursorId = args.cursor.recordId ?? "00000000-0000-0000-0000-000000000000";
  let drained = false;
  // Bank observations live in Hindsight — route to the Hindsight handle.
  const hdb = resolveHindsightDb(args.db);

  while (candidates.length < args.limit) {
    const pageSize = Math.min(PAGE_SIZE, args.limit - candidates.length);
    const result = await hdb.execute(sql`
			SELECT
				id::text AS id,
				text,
				source_memory_ids,
				date_trunc('milliseconds', COALESCE(updated_at, created_at)) AS cursor_ts
			FROM ${hindsightSql()}memory_units
			WHERE bank_id = ${args.bankId}
			  AND fact_type = 'observation'
			  AND source_memory_ids IS NOT NULL
			  AND array_length(source_memory_ids, 1) > 0
			  AND COALESCE(metadata->>'evalTraffic', '') NOT IN ('true')
			  AND (
				date_trunc('milliseconds', COALESCE(updated_at, created_at)) > ${cursorTs.toISOString()}::timestamptz
				OR (
					date_trunc('milliseconds', COALESCE(updated_at, created_at)) = ${cursorTs.toISOString()}::timestamptz
					AND id::text > ${cursorId}
				)
			  )
			ORDER BY cursor_ts ASC, id ASC
			LIMIT ${pageSize}
		`);
    const rows = (result.rows ?? []) as Array<{
      id: string;
      text: string;
      source_memory_ids: string[] | null;
      cursor_ts: string | Date;
    }>;
    if (rows.length === 0) {
      drained = true;
      break;
    }
    for (const row of rows) {
      candidates.push({
        id: row.id,
        bankId: args.bankId,
        userId: args.userId,
        text: String(row.text ?? ""),
        sourceMemoryIds: Array.isArray(row.source_memory_ids)
          ? row.source_memory_ids.map(String)
          : [],
      });
    }
    const last = rows[rows.length - 1]!;
    cursorTs = new Date(last.cursor_ts);
    cursorId = last.id;
    if (rows.length < pageSize) {
      drained = true;
      break;
    }
  }

  return {
    candidates,
    nextCursor: { updatedAt: cursorTs, recordId: cursorId },
    drained,
  };
}

/** Load persisted per-bank cursors for the tenant. */
export async function loadObservationCursors(
  db: Database,
  tenantId: string,
): Promise<Map<string, ObservationCursor>> {
  const result = await db.execute(sql`
		SELECT bank_id, last_record_updated_at, last_record_id
		FROM knowledge_graph_observation_cursors
		WHERE tenant_id = ${tenantId}
	`);
  const cursors = new Map<string, ObservationCursor>();
  for (const row of (result.rows ?? []) as Array<{
    bank_id: string;
    last_record_updated_at: string | Date | null;
    last_record_id: string | null;
  }>) {
    cursors.set(row.bank_id, {
      updatedAt: row.last_record_updated_at
        ? new Date(row.last_record_updated_at)
        : null,
      recordId: row.last_record_id,
    });
  }
  return cursors;
}

/**
 * Collect the tenant's new observation candidates across all user banks.
 * The per-run cap bounds classifier cost and keeps backlog recovery chunked;
 * `truncated` tells the worker more work remains for the next run.
 */
export async function collectTenantObservationCandidates(args: {
  db: Database;
  tenantId: string;
  cursors: Map<string, ObservationCursor>;
  maxCandidates?: number;
  /** Explicit shared banks (validated) — omits the user-bank estate sweep. */
  bankIds?: string[];
}): Promise<ObservationCandidateBatch> {
  const cap = Math.max(1, args.maxCandidates ?? DEFAULT_MAX_CANDIDATES_PER_RUN);
  const banks: Array<{ bankId: string; userId: string | null }> =
    args.bankIds && args.bankIds.length > 0
      ? validateExplicitBankIds(args.bankIds)
      : await enumerateTenantBanks(args.db, args.tenantId);
  const candidates: GateCandidate[] = [];
  const nextCursors = new Map<string, ObservationCursor>();
  let truncated = false;

  for (const bank of banks) {
    const remaining = cap - candidates.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const cursor = args.cursors.get(bank.bankId) ?? {
      updatedAt: null,
      recordId: null,
    };
    const batch = await readBankObservations({
      db: args.db,
      bankId: bank.bankId,
      userId: bank.userId,
      cursor,
      limit: remaining,
    });
    if (batch.candidates.length > 0) {
      candidates.push(...batch.candidates);
      nextCursors.set(bank.bankId, batch.nextCursor);
    }
    if (!batch.drained) truncated = true;
  }

  return { candidates, nextCursors, truncated };
}

/**
 * Build the ingest source bundle for a tenant's promoted observations.
 * Packets carry no pre-declared entity types — extraction happens under the
 * approved-ontology constraint; the normalizer gates the result.
 */
export async function loadObservationsKnowledgeGraphSource(args: {
  db: Database;
  tenantId: string;
  sourceRef: string;
  sourceLabel: string;
  maxCandidates?: number;
  /** Explicit shared banks (`space_*`/`tenant_*` only) for targeted ingest. */
  bankIds?: string[];
  gateDeps?: Omit<PromotionGateDeps, "db">;
}): Promise<{
  bundle: KnowledgeGraphSourceBundle;
  gate: GateResult;
  nextCursors: Map<string, ObservationCursor>;
  truncated: boolean;
  candidateCount: number;
}> {
  const cursors = await loadObservationCursors(args.db, args.tenantId);
  const batch = await collectTenantObservationCandidates({
    db: args.db,
    tenantId: args.tenantId,
    cursors,
    maxCandidates: args.maxCandidates,
    bankIds: args.bankIds,
  });

  const gate = await applyPromotionGate(batch.candidates, {
    db: args.db,
    ...(args.gateDeps ?? {}),
  });

  // Durable claim support (U4): out-of-band join from each observation's
  // world units to the claim ledger. Empty for observations without
  // document linkage — see claim-support.ts. Best-effort: a claim-support
  // failure degrades to enrichment prose, never fails the ingest.
  let claimIdsByObservation = new Map<string, string[]>();
  try {
    claimIdsByObservation = await resolveObservationClaimSupport({
      db: args.db,
      tenantId: args.tenantId,
      observations: gate.promoted.map((candidate) => ({
        id: candidate.id,
        sourceMemoryIds: candidate.sourceMemoryIds,
      })),
    });
  } catch (err) {
    console.warn("[observations-source] claim support resolution failed", {
      tenantId: args.tenantId,
      error: (err as Error)?.message ?? String(err),
    });
  }

  const packets: KnowledgeGraphSourcePacket[] = gate.promoted.map(
    (candidate, index) => ({
      id: candidate.id,
      title: `Observation ${index + 1}`,
      entityTypeSlug: null,
      trustedOntologyType: false,
      text: candidate.text,
      metadata: {
        observationId: candidate.id,
        bankId: candidate.bankId,
        proofCount: candidate.sourceMemoryIds.length,
        ...(claimIdsByObservation.has(candidate.id)
          ? { claimIds: claimIdsByObservation.get(candidate.id) }
          : {}),
      },
    }),
  );

  const now = new Date();
  const bundle: KnowledgeGraphSourceBundle = {
    sourceKind: "observations",
    sourceRef: args.sourceRef,
    sourceLabel: args.sourceLabel,
    document: renderPacketDocument({ heading: args.sourceLabel, packets }),
    evidence: gate.promoted.map((candidate, index) => ({
      id: candidate.id,
      role: "source",
      senderType: "observation",
      senderId: null,
      speakerLabel: `Observation (${candidate.sourceMemoryIds.length} supporting facts)`,
      text: candidate.text,
      createdAt: now,
      ordinal: index,
      evidenceSourceKind: "hindsight_observation",
      evidenceSourceRef: candidate.id,
      evidenceMetadata: {
        observationId: candidate.id,
        bankId: candidate.bankId,
        proofCount: candidate.sourceMemoryIds.length,
        ...(claimIdsByObservation.has(candidate.id)
          ? { claimIds: claimIdsByObservation.get(candidate.id) }
          : {}),
      },
    })),
    packets,
    relationships: [],
    packetCount: packets.length,
    skippedCount: gate.excluded.length,
    diagnostics: {
      candidateCount: batch.candidates.length,
      promotedCount: gate.promoted.length,
      excludedCounts: gate.audit.excludedCounts,
      classifierModelId: gate.audit.classifierModelId,
      classifierPromptVersion: gate.audit.classifierPromptVersion,
      truncated: batch.truncated,
    },
  };

  return {
    bundle,
    gate,
    nextCursors: batch.nextCursors,
    truncated: batch.truncated,
    candidateCount: batch.candidates.length,
  };
}
