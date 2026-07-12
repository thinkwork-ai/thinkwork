/**
 * Knowledge Base document manifest reconciliation (THINK-193 U7).
 *
 * The knowledge-base-manager Lambda calls reconcileKnowledgeBaseDocuments
 * ONLY after a successful Bedrock ingestion job (StartIngestionJob →
 * COMPLETE) — the manifest never claims an edition the KB hasn't indexed,
 * and the manager never races StartIngestionJob with direct Ingest calls.
 *
 * Manifest shape: ONE row per (knowledge_base_id, data_source_id,
 * document_key); the row id is the document's stable identity across
 * editions. A changed etag bumps `edition` in place and re-opens
 * effective_from — the PRIOR edition's interval closes in the claim ledger
 * when the bedrock_kb adapter's new evidence edition supersedes it
 * (upsertClaimsForEvidence), so document history lives in
 * memory_evidence_items/memory_claims, not in duplicate manifest rows.
 *
 * Deletion lifecycle (zero-residue, KB-preserving):
 *   S3 object gone (or delete stamped by knowledge-base-files) →
 *     ingest_status 'deleting'
 *   → enqueueManifestRetractions chains the STANDARD Hindsight derivation
 *     retraction for every bedrock_kb source config bound to the KB
 *     (provider stays 'hindsight' — no new retraction provider)
 *   → settleDeletedDocuments flips 'deleting' → 'absent_verified' ONLY
 *     after Bedrock reports the document absent AND a scoped Retrieve
 *     returns no hits; unsettled rows are retried on subsequent syncs
 *     (manifest-owned — no new saga provider).
 *
 * NOTE: the KB documents themselves are NEVER deleted by memory-source
 * machinery — the KB is the authoritative verbatim store; erase of a
 * bedrock_kb SOURCE covers evidence/snapshots/claims/Hindsight docs only.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  knowledgeBaseDocuments,
  memoryDerivations,
  memorySourceConfigs,
} from "@thinkwork/database-pg/schema";

import { kbDocumentProjectionKey } from "../memory-sources/adapters/bedrock-kb.js";
import { enqueueDerivationRetraction } from "../memory-sources/retraction.js";
import type { DbHandle } from "../memory-sources/types.js";

export type KbManifestRow = typeof knowledgeBaseDocuments.$inferSelect;

/** One live S3 object under the KB documents prefix. */
export interface ManifestS3Object {
  /** Full S3 key. */
  key: string;
  /** ETag with quotes stripped (normalizeManifestEtag). */
  etag: string | null;
  versionId?: string | null;
}

/** Strip the RFC quotes S3 puts around ETag values. */
export function normalizeManifestEtag(
  etag: string | null | undefined,
): string | null {
  if (!etag) return null;
  const stripped = etag.replace(/"/g, "");
  return stripped || null;
}

/**
 * PURE: map a Bedrock KnowledgeBaseDocument status onto the manifest's
 * ingest_status domain. Unknown/in-flight statuses map to 'ingesting'
 * (Bedrock owns them); an S3-present document Bedrock doesn't know yet is
 * 'pending'.
 */
export function bedrockDocStatusToIngestStatus(
  status: string | null | undefined,
): "pending" | "ingesting" | "indexed" | "failed" {
  switch (status) {
    case "INDEXED":
    case "PARTIALLY_INDEXED":
      return "indexed";
    case "FAILED":
    case "METADATA_UPDATE_FAILED":
      return "failed";
    case undefined:
    case null:
    case "NOT_FOUND":
      return "pending";
    default:
      return "ingesting";
  }
}

export interface ReconcileResult {
  created: number;
  editionsBumped: number;
  statusUpdated: number;
  unchanged: number;
  /** Manifest rows that are 'deleting' and still need the Hindsight
   * retraction chain (projection never enqueued). */
  deletingNeedingRetraction: KbManifestRow[];
}

/**
 * Reconcile the manifest against the live S3 listing + Bedrock per-document
 * statuses, after a successful sync. Idempotent: replaying the same inputs
 * touches nothing.
 */
export async function reconcileKnowledgeBaseDocuments(
  db: DbHandle,
  args: {
    tenantId: string;
    knowledgeBaseId: string;
    dataSourceId: string;
    s3Objects: ManifestS3Object[];
    /** Full S3 key → Bedrock document status (ListKnowledgeBaseDocuments). */
    bedrockStatusByKey: Map<string, string>;
    now?: Date;
  },
): Promise<ReconcileResult> {
  const now = args.now ?? new Date();
  const existing = await db
    .select()
    .from(knowledgeBaseDocuments)
    .where(
      and(
        eq(knowledgeBaseDocuments.knowledge_base_id, args.knowledgeBaseId),
        eq(knowledgeBaseDocuments.data_source_id, args.dataSourceId),
      ),
    );
  const byKey = new Map(existing.map((row) => [row.document_key, row]));

  let created = 0;
  let editionsBumped = 0;
  let statusUpdated = 0;
  let unchanged = 0;

  for (const object of args.s3Objects) {
    const etag = normalizeManifestEtag(object.etag);
    const ingestStatus = bedrockDocStatusToIngestStatus(
      args.bedrockStatusByKey.get(object.key),
    );
    const row = byKey.get(object.key);

    if (!row) {
      await db.insert(knowledgeBaseDocuments).values({
        tenant_id: args.tenantId,
        knowledge_base_id: args.knowledgeBaseId,
        data_source_id: args.dataSourceId,
        document_key: object.key,
        etag,
        s3_version_id: object.versionId ?? null,
        // The manifest's content identity is the S3 etag until the adapter
        // computes a snapshot hash; the evidence ledger owns the precise
        // content hash per edition.
        content_hash: etag,
        edition: 1,
        effective_from: now,
        effective_to: null,
        ingest_status: ingestStatus,
        projection_status: "pending",
        updated_at: now,
      });
      created += 1;
      continue;
    }

    const priorEtag = normalizeManifestEtag(row.etag);
    if (etag !== null && priorEtag !== null && etag !== priorEtag) {
      // Changed content: bump the edition in place (the stable row id keeps
      // the Hindsight projection replacing rather than duplicating) and
      // re-open the effective interval. This also RESURRECTS a 'deleting'
      // row whose object was re-uploaded before settlement.
      await db
        .update(knowledgeBaseDocuments)
        .set({
          etag,
          s3_version_id: object.versionId ?? null,
          content_hash: etag,
          edition: row.edition + 1,
          effective_from: now,
          effective_to: null,
          ingest_status: ingestStatus,
          projection_status: "pending",
          last_error: null,
          updated_at: now,
        })
        .where(eq(knowledgeBaseDocuments.id, row.id));
      editionsBumped += 1;
      continue;
    }

    if (
      row.ingest_status !== ingestStatus ||
      (object.versionId != null && row.s3_version_id !== object.versionId)
    ) {
      // Same content, new lifecycle fact (e.g. pending → indexed after this
      // sync, or a 'deleting' row whose identical object reappeared).
      await db
        .update(knowledgeBaseDocuments)
        .set({
          ingest_status: ingestStatus,
          s3_version_id: object.versionId ?? row.s3_version_id,
          effective_to: null,
          updated_at: now,
        })
        .where(eq(knowledgeBaseDocuments.id, row.id));
      statusUpdated += 1;
      continue;
    }

    // Same etag, same status: idempotent no-op — updated_at is NOT bumped,
    // so the adapter's cursor does not re-project an unchanged document.
    unchanged += 1;
  }

  // S3-absent documents: stamp delete intent. Settlement (absent_verified)
  // and the Hindsight retraction chain are separate, retryable steps.
  const liveKeys = new Set(args.s3Objects.map((object) => object.key));
  for (const row of existing) {
    if (liveKeys.has(row.document_key)) continue;
    if (row.ingest_status === "absent_verified") continue;
    if (row.ingest_status !== "deleting") {
      await db
        .update(knowledgeBaseDocuments)
        .set({ ingest_status: "deleting", updated_at: now })
        .where(eq(knowledgeBaseDocuments.id, row.id));
    }
  }

  // Every 'deleting' row whose projection has not yet entered retraction —
  // including rows stamped by knowledge-base-files before this sync.
  const deletingNeedingRetraction = await db
    .select()
    .from(knowledgeBaseDocuments)
    .where(
      and(
        eq(knowledgeBaseDocuments.knowledge_base_id, args.knowledgeBaseId),
        eq(knowledgeBaseDocuments.data_source_id, args.dataSourceId),
        eq(knowledgeBaseDocuments.ingest_status, "deleting"),
        inArray(knowledgeBaseDocuments.projection_status, [
          "pending",
          "projected",
          "skipped",
          "failed",
        ]),
      ),
    );

  return {
    created,
    editionsBumped,
    statusUpdated,
    unchanged,
    deletingNeedingRetraction,
  };
}

/**
 * Chain the STANDARD Hindsight derivation retraction for deleted
 * documents: for every bedrock_kb source config bound to this KB
 * (source_binding_key = knowledge_bases.id), enqueue retraction of the
 * active/superseded derivation whose projection_key matches the document.
 * The projection target is Hindsight, so memory_retraction_attempts keeps
 * provider 'hindsight' — no new provider. Manifest settlement stays
 * independent (settleDeletedDocuments).
 */
export async function enqueueManifestRetractions(
  db: DbHandle,
  args: {
    tenantId: string;
    knowledgeBaseId: string;
    rows: KbManifestRow[];
  },
): Promise<{ enqueued: number }> {
  if (args.rows.length === 0) return { enqueued: 0 };

  const sourceConfigs = await db
    .select({ id: memorySourceConfigs.id })
    .from(memorySourceConfigs)
    .where(
      and(
        eq(memorySourceConfigs.tenant_id, args.tenantId),
        eq(memorySourceConfigs.source_family, "bedrock_kb"),
        eq(memorySourceConfigs.source_binding_key, args.knowledgeBaseId),
      ),
    );

  let enqueued = 0;
  for (const row of args.rows) {
    const projectionKey = kbDocumentProjectionKey(row.document_key);
    let sawDerivation = false;
    for (const config of sourceConfigs) {
      const derivations = await db
        .select({ id: memoryDerivations.id })
        .from(memoryDerivations)
        .where(
          and(
            eq(memoryDerivations.tenant_id, args.tenantId),
            eq(memoryDerivations.source_config_id, config.id),
            eq(memoryDerivations.projection_key, projectionKey),
            inArray(memoryDerivations.lifecycle, ["active", "superseded"]),
          ),
        );
      for (const derivation of derivations) {
        sawDerivation = true;
        const attempt = await enqueueDerivationRetraction(db, {
          tenantId: args.tenantId,
          derivationId: derivation.id,
        });
        if (attempt) enqueued += 1;
      }
    }
    await db
      .update(knowledgeBaseDocuments)
      .set({
        // 'retracting' when a Hindsight retraction is in flight; straight to
        // 'retracted' when nothing was ever projected for this document.
        projection_status: sawDerivation ? "retracting" : "retracted",
      })
      .where(eq(knowledgeBaseDocuments.id, row.id));
  }
  return { enqueued };
}

/** Provider probes injected by the manager (real Bedrock in production,
 * fakes in tests). */
export interface SettlementProbes {
  /** GetKnowledgeBaseDocuments: is the document absent/not-indexed? */
  isDocumentAbsent(documentKey: string): Promise<boolean>;
  /** Scoped Retrieve filtered to the document's source uri: any hits? */
  retrieveHasResidue(documentKey: string): Promise<boolean>;
}

/**
 * Deletion settlement, retried on every sync: a 'deleting' row becomes
 * 'absent_verified' (effective_to closed) ONLY when Bedrock reports the
 * document absent AND a scoped Retrieve returns no hits. A probe failure
 * leaves the row 'deleting' with last_error — visible and retryable.
 */
export async function settleDeletedDocuments(
  db: DbHandle,
  args: {
    tenantId: string;
    knowledgeBaseId: string;
    dataSourceId: string;
    probes: SettlementProbes;
    now?: Date;
  },
): Promise<{ settled: number; pending: number }> {
  const now = args.now ?? new Date();
  const deleting = await db
    .select()
    .from(knowledgeBaseDocuments)
    .where(
      and(
        eq(knowledgeBaseDocuments.knowledge_base_id, args.knowledgeBaseId),
        eq(knowledgeBaseDocuments.data_source_id, args.dataSourceId),
        eq(knowledgeBaseDocuments.ingest_status, "deleting"),
      ),
    );

  let settled = 0;
  let pending = 0;
  for (const row of deleting) {
    try {
      const absent = await args.probes.isDocumentAbsent(row.document_key);
      if (!absent) {
        pending += 1;
        continue;
      }
      const residue = await args.probes.retrieveHasResidue(row.document_key);
      if (residue) {
        pending += 1;
        continue;
      }
      await db
        .update(knowledgeBaseDocuments)
        .set({
          ingest_status: "absent_verified",
          effective_to: now,
          last_error: null,
          updated_at: now,
        })
        .where(eq(knowledgeBaseDocuments.id, row.id));
      settled += 1;
    } catch (err) {
      pending += 1;
      const reason = (err as Error)?.message ?? String(err);
      await db
        .update(knowledgeBaseDocuments)
        .set({
          last_error: `settlement probe failed: ${reason}`.slice(0, 1000),
          updated_at: now,
        })
        .where(eq(knowledgeBaseDocuments.id, row.id));
    }
  }
  return { settled, pending };
}

/**
 * Delete-intent stamp for knowledge-base-files' delete action: mark the
 * open manifest row 'deleting' immediately so the operator sees the intent
 * before the next sync reconciles/settles it. No-op when no manifest row
 * exists (pre-manifest uploads reconcile on the next sync).
 */
export async function stampDocumentDeleteIntent(
  db: DbHandle,
  args: { knowledgeBaseId: string; documentKey: string; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await db
    .update(knowledgeBaseDocuments)
    .set({ ingest_status: "deleting", updated_at: now })
    .where(
      and(
        eq(knowledgeBaseDocuments.knowledge_base_id, args.knowledgeBaseId),
        eq(knowledgeBaseDocuments.document_key, args.documentKey),
      ),
    );
}

/**
 * Upload-intent stamp for knowledge-base-files' direct upload action: the
 * open manifest row (if any) drops back to 'pending' so the operator sees
 * "awaiting sync". Edition bumping is reconcile-owned (etag comparison
 * after successful ingestion) — never done here. No-op for new documents
 * (the first reconcile inserts edition 1) and for presigned uploads (the
 * handler never observes their completion).
 */
export async function stampDocumentUploadIntent(
  db: DbHandle,
  args: { knowledgeBaseId: string; documentKey: string; now?: Date },
): Promise<void> {
  const now = args.now ?? new Date();
  await db
    .update(knowledgeBaseDocuments)
    .set({ ingest_status: "pending", effective_to: null, updated_at: now })
    .where(
      and(
        eq(knowledgeBaseDocuments.knowledge_base_id, args.knowledgeBaseId),
        eq(knowledgeBaseDocuments.document_key, args.documentKey),
      ),
    );
}
