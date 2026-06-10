/**
 * Graph → wiki materializer (plan 2026-06-09-004 U10).
 *
 * Deterministic, LLM-free: extraction already happened in Cognee. Reads
 * grounded entities + relationships + observation evidence from the Aurora
 * knowledge_graph_* mirror (source_kind='observations',
 * grounding_status='grounded' only) for one tenant and materializes
 * TENANT-scoped wiki pages (owner_id NULL) through the existing repository
 * layer:
 *
 *   - one `entity` page per grounded entity, slug from the shared
 *     `slugifyTitle` helper (same slugging the planner pipeline uses, so a
 *     given label always lands on the same slug);
 *   - an 'overview' section plus a 'relationships' section listing edges;
 *   - `wiki.page_links` between co-materialized entity pages;
 *   - section provenance rows with source_kind 'hindsight_observation' and
 *     source_ref = the backing observation id
 *     (knowledge_graph_evidence.evidence_source_ref where
 *     evidence_source_kind='hindsight_observation') — observation IDs only,
 *     never snippet text (R17).
 *
 * Reconciliation: tenant pages previously produced by this materializer
 * (identified via 'hindsight_observation' section sources — this module is
 * the only writer of that kind) whose backing entity no longer exists in the
 * mirror flip to status 'archived'. This is the recovery path after
 * shrink-guard events and full rebuilds — without it, poison persisted to
 * pages would outlive the mirror fix.
 *
 * Idempotency: slug-keyed page upserts + deterministic section slugs +
 * ON CONFLICT DO NOTHING provenance/link writes — re-running against an
 * unchanged mirror produces no duplicate pages, sections, sources, or links.
 *
 * NO continuation chaining: unlike the planner (cursor-capped incremental
 * batches), each run is a full pass over the tenant's mirror, so there is
 * never a "remaining cursor" to chain forward. Graph-mode dedupe keys are
 * four-part (`graph:obs:{tenant}:{bucket}`) so `parseCompileDedupeBucket`
 * returns null for them and the planner's chaining logic can never engage.
 */

import { sql } from "drizzle-orm";
import { db as defaultDb } from "../db.js";
import { slugifyTitle, seedAliasesForTitle } from "./aliases.js";
import {
  archivePagesByIds,
  claimCompileJobById,
  claimNextCompileJob,
  completeCompileJob,
  listGraphMaterializedTenantPages,
  upsertPage,
  upsertPageLink,
  type DbClient,
  type WikiCompileJobRow,
  type WikiSectionInput,
} from "./repository.js";

/** The only mirror rows the materializer may read (Phase B contract). */
const GRAPH_SOURCE_KIND = "observations";

/** Per-section cap on provenance rows — keeps heavy entities bounded. */
const MAX_SECTION_SOURCES = 25;

export interface GraphMaterializeMetrics {
  entities_seen: number;
  relationships_seen: number;
  pages_upserted: number;
  pages_skipped: number;
  pages_archived: number;
  links_written: number;
  [key: string]: number;
}

export interface GraphMaterializeResult {
  tenantId: string;
  metrics: GraphMaterializeMetrics;
}

interface MirrorEntityRow {
  id: string;
  label: string;
  normalized_label: string;
  ontology_type_slug: string | null;
  summary: string | null;
  aliases: string[] | null;
}

interface MirrorRelationshipRow {
  id: string;
  label: string;
  source_entity_id: string;
  target_entity_id: string;
  from_label: string;
  to_label: string;
}

interface MirrorEvidenceRow {
  entity_id: string | null;
  relationship_id: string | null;
  evidence_source_ref: string;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function dedupeCap(ids: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Materialize the tenant wiki from the knowledge-graph mirror. Pure data
 * transformation + repository writes; never reads env, never calls a model.
 */
export async function materializeTenantWikiFromGraph(
  args: { tenantId: string },
  db: DbClient = defaultDb,
): Promise<GraphMaterializeResult> {
  const metrics: GraphMaterializeMetrics = {
    entities_seen: 0,
    relationships_seen: 0,
    pages_upserted: 0,
    pages_skipped: 0,
    pages_archived: 0,
    links_written: 0,
  };

  // -- Mirror reads (grounded observations rows only) -----------------------
  const entityRows = rowsOf<MirrorEntityRow>(
    await db.execute(sql`
			SELECT id, label, normalized_label, ontology_type_slug, summary, aliases
			FROM knowledge_graph_entities
			WHERE tenant_id = ${args.tenantId}
			  AND source_kind = ${GRAPH_SOURCE_KIND}
			  AND grounding_status = 'grounded'
			ORDER BY normalized_label ASC, id ASC
		`),
  );
  metrics.entities_seen = entityRows.length;

  const relationshipRows = rowsOf<MirrorRelationshipRow>(
    await db.execute(sql`
			SELECT r.id, r.label, r.source_entity_id, r.target_entity_id,
			       se.label AS from_label, te.label AS to_label
			FROM knowledge_graph_relationships r
			JOIN knowledge_graph_entities se ON se.id = r.source_entity_id
			JOIN knowledge_graph_entities te ON te.id = r.target_entity_id
			WHERE r.tenant_id = ${args.tenantId}
			  AND r.source_kind = ${GRAPH_SOURCE_KIND}
			  AND r.grounding_status = 'grounded'
			ORDER BY se.normalized_label ASC, te.normalized_label ASC, r.label ASC, r.id ASC
		`),
  );
  metrics.relationships_seen = relationshipRows.length;

  const evidenceRows = rowsOf<MirrorEvidenceRow>(
    await db.execute(sql`
			SELECT entity_id, relationship_id, evidence_source_ref
			FROM knowledge_graph_evidence
			WHERE tenant_id = ${args.tenantId}
			  AND source_kind = ${GRAPH_SOURCE_KIND}
			  AND evidence_source_kind = 'hindsight_observation'
			  AND evidence_source_ref IS NOT NULL
			ORDER BY created_at ASC, id ASC
		`),
  );

  const observationIdsByEntity = new Map<string, string[]>();
  const observationIdsByRelationship = new Map<string, string[]>();
  for (const row of evidenceRows) {
    if (row.entity_id) {
      const list = observationIdsByEntity.get(row.entity_id) ?? [];
      list.push(row.evidence_source_ref);
      observationIdsByEntity.set(row.entity_id, list);
    }
    if (row.relationship_id) {
      const list = observationIdsByRelationship.get(row.relationship_id) ?? [];
      list.push(row.evidence_source_ref);
      observationIdsByRelationship.set(row.relationship_id, list);
    }
  }

  const relationshipsByEntity = new Map<string, MirrorRelationshipRow[]>();
  for (const rel of relationshipRows) {
    for (const entityId of [rel.source_entity_id, rel.target_entity_id]) {
      const list = relationshipsByEntity.get(entityId) ?? [];
      list.push(rel);
      relationshipsByEntity.set(entityId, list);
    }
  }

  // -- Page materialization (slug-keyed upserts, deterministic sections) ----
  // First entity per slug wins; later same-slug entities fold into the same
  // page row via the upsert, so we track the page id per slug for linking.
  const pageIdBySlug = new Map<string, string>();
  const pageIdByEntityId = new Map<string, string>();

  for (const entity of entityRows) {
    const slug = slugifyTitle(entity.label);
    if (!slug) {
      metrics.pages_skipped += 1;
      continue;
    }

    const entityObservationIds = dedupeCap(
      observationIdsByEntity.get(entity.id) ?? [],
      MAX_SECTION_SOURCES,
    );
    const entityRelationships = relationshipsByEntity.get(entity.id) ?? [];

    const sections: WikiSectionInput[] = [
      {
        section_slug: "overview",
        heading: "Overview",
        body_md:
          entity.summary?.trim() ||
          `${entity.label} is tracked in the tenant knowledge graph.`,
        position: 0,
        sources: entityObservationIds.map((ref) => ({
          kind: "hindsight_observation" as const,
          ref,
        })),
      },
    ];

    if (entityRelationships.length > 0) {
      const relationshipObservationIds = dedupeCap(
        entityRelationships.flatMap(
          (rel) => observationIdsByRelationship.get(rel.id) ?? [],
        ),
        MAX_SECTION_SOURCES,
      );
      sections.push({
        section_slug: "relationships",
        heading: "Relationships",
        body_md: entityRelationships
          .map((rel) => `- ${rel.from_label} — ${rel.label} — ${rel.to_label}`)
          .join("\n"),
        position: 1,
        sources: relationshipObservationIds.map((ref) => ({
          kind: "hindsight_observation" as const,
          ref,
        })),
      });
    }

    const page = await upsertPage(
      {
        tenant_id: args.tenantId,
        owner_id: null, // tenant scope
        type: "entity",
        entity_subtype: entity.ontology_type_slug ?? null,
        slug,
        title: entity.label,
        summary: entity.summary ?? null,
        markCompiled: true,
        sections,
        aliases: [
          ...seedAliasesForTitle(entity.label),
          ...(entity.aliases ?? []),
        ].map((alias) => ({ alias, source: "compiler" })),
      },
      db,
    );

    if (!pageIdBySlug.has(slug)) {
      metrics.pages_upserted += 1;
      pageIdBySlug.set(slug, page.id);
    }
    pageIdByEntityId.set(entity.id, page.id);
  }

  // -- Links between co-materialized entity pages ---------------------------
  for (const rel of relationshipRows) {
    const fromPageId = pageIdByEntityId.get(rel.source_entity_id);
    const toPageId = pageIdByEntityId.get(rel.target_entity_id);
    if (!fromPageId || !toPageId || fromPageId === toPageId) continue;
    const inserted = await upsertPageLink(
      {
        fromPageId,
        toPageId,
        kind: "reference",
        context: rel.label,
      },
      db,
    );
    if (inserted) metrics.links_written += 1;
  }

  // -- Reconciliation: archive pages whose backing entity vanished ----------
  const materializedPages = await listGraphMaterializedTenantPages(
    { tenantId: args.tenantId },
    db,
  );
  const liveSlugs = new Set(pageIdBySlug.keys());
  const staleIds = materializedPages
    .filter((page) => page.type === "entity" && !liveSlugs.has(page.slug))
    .map((page) => page.id);
  if (staleIds.length > 0) {
    metrics.pages_archived = await archivePagesByIds({ pageIds: staleIds }, db);
  }

  return { tenantId: args.tenantId, metrics };
}

// ---------------------------------------------------------------------------
// Compile-job runners — graph-mode counterparts of the planner's
// runCompileJob / runJobById, dispatched by wiki-compile when
// WIKI_SOURCE='graph'. Tenant-keyed jobs only; deliberately NO continuation
// chaining (see module docstring).
// ---------------------------------------------------------------------------

export interface GraphCompileJobResult {
  jobId: string;
  status: "succeeded" | "failed" | "skipped";
  metrics?: GraphMaterializeMetrics;
  error?: string;
}

async function runClaimedGraphCompileJob(
  job: WikiCompileJobRow,
  db: DbClient,
): Promise<GraphCompileJobResult> {
  // Residual owner-scoped jobs (planner / lint promotion / enrichment
  // drafts) are not materialization work — skip them rather than running a
  // tenant materialization under a user-keyed ledger row. The graph
  // dispatcher only ever enqueues tenant-keyed (null-owner) jobs.
  if (job.owner_id !== null) {
    await completeCompileJob(
      {
        jobId: job.id,
        status: "skipped",
        error: "owner-scoped job skipped under WIKI_SOURCE=graph",
      },
      db,
    );
    return { jobId: job.id, status: "skipped" };
  }
  try {
    const { metrics } = await materializeTenantWikiFromGraph(
      { tenantId: job.tenant_id },
      db,
    );
    await completeCompileJob(
      { jobId: job.id, status: "succeeded", metrics },
      db,
    );
    return { jobId: job.id, status: "succeeded", metrics };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    await completeCompileJob(
      { jobId: job.id, status: "failed", error: msg },
      db,
    );
    return { jobId: job.id, status: "failed", error: msg };
  }
}

/** Claim a specific job by id and materialize. Null = nothing claimable. */
export async function runGraphCompileJobById(
  jobId: string,
  db: DbClient = defaultDb,
): Promise<GraphCompileJobResult | null> {
  const job = await claimCompileJobById(jobId, db);
  if (!job) return null;
  return runClaimedGraphCompileJob(job, db);
}

/** Claim the next pending job and materialize. Null = queue empty. */
export async function runNextGraphCompileJob(
  db: DbClient = defaultDb,
): Promise<GraphCompileJobResult | null> {
  const job = await claimNextCompileJob(db);
  if (!job) return null;
  return runClaimedGraphCompileJob(job, db);
}
