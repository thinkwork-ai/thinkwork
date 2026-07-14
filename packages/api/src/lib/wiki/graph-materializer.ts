/**
 * Graph → wiki materializer (plan 2026-06-09-004 U10).
 *
 * Deterministic, LLM-free: extraction already happened in the graph pipeline. Reads
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
 *     (kg.evidence.evidence_source_ref where
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
  parseDirtyCanonicalEntityIds,
  upsertCanonicalEntityPage,
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

/**
 * Evidence-threshold promotion (THINK-133 U5, R7/KTD-7). An entity earns a
 * wiki page by crossing mechanical thresholds — never by ontology type. The
 * single config point for tuning against dev data; no tenant surface in v1.
 */
export interface WikiPromotionThresholds {
  minDistinctEvidence: number;
  minRelationships: number;
  minPromotedNeighborLinks: number;
}

export const WIKI_PROMOTION_THRESHOLDS: WikiPromotionThresholds = {
  /**
   * Distinct evidence mentions (distinct threads where evidence carries a
   * thread_id; distinct observations otherwise).
   */
  minDistinctEvidence: 3,
  /** OR: the entity participates in at least this many relationships. */
  minRelationships: 2,
  /**
   * OR: the entity is referenced by an already-promoted entity's page via
   * at least this many relationships (single propagation pass, no cascade).
   */
  minPromotedNeighborLinks: 1,
};

/**
 * Pure promotion decision. Base pass: evidence or relationship thresholds.
 * Second pass: entities linked to a base-promoted entity promote
 * ("referenced by another page"), deliberately non-transitive so one hub
 * entity cannot promote the whole graph.
 */
export function computePromotedEntityIds(args: {
  entityIds: string[];
  evidenceKeysByEntity: Map<string, Set<string>>;
  adjacency: Map<string, string[]>;
  thresholds?: WikiPromotionThresholds;
}): Set<string> {
  const thresholds = args.thresholds ?? WIKI_PROMOTION_THRESHOLDS;
  const promoted = new Set<string>();

  for (const entityId of args.entityIds) {
    const evidenceCount = args.evidenceKeysByEntity.get(entityId)?.size ?? 0;
    const relationshipCount = args.adjacency.get(entityId)?.length ?? 0;
    if (
      evidenceCount >= thresholds.minDistinctEvidence ||
      relationshipCount >= thresholds.minRelationships
    ) {
      promoted.add(entityId);
    }
  }

  // Frozen base set: second-pass promotions never seed further promotions,
  // regardless of iteration order.
  const basePromoted = new Set(promoted);
  for (const entityId of args.entityIds) {
    if (basePromoted.has(entityId)) continue;
    const promotedNeighborLinks = (args.adjacency.get(entityId) ?? []).filter(
      (neighborId) => basePromoted.has(neighborId),
    ).length;
    if (promotedNeighborLinks >= thresholds.minPromotedNeighborLinks) {
      promoted.add(entityId);
    }
  }

  return promoted;
}

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
  canonical_entity_id: string | null;
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
  thread_id: string | null;
  metadata: Record<string, unknown> | null;
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
 *
 * THINK-193 U4: pages are keyed by canonical entity id when the mirror rows
 * carry one (partition by canonical id; slug/title/aliases become
 * presentation, renames update the same page and alias the old slug).
 * Legacy rows without canonical ids keep the slug-keyed path. A dirty
 * canonical-id scope (from the ingest run's enqueue) restricts the pass to
 * those canonical entities; the archive reconciliation only runs on FULL
 * passes (a scoped pass cannot see the full live set).
 */
export async function materializeTenantWikiFromGraph(
  args: {
    tenantId: string;
    /** Dirty canonical scope; null/undefined = full pass. */
    dirtyCanonicalEntityIds?: string[] | null;
  },
  db: DbClient = defaultDb,
): Promise<GraphMaterializeResult> {
  const dirtyScope =
    args.dirtyCanonicalEntityIds && args.dirtyCanonicalEntityIds.length > 0
      ? args.dirtyCanonicalEntityIds
      : null;
  const metrics: GraphMaterializeMetrics = {
    entities_seen: 0,
    relationships_seen: 0,
    pages_upserted: 0,
    pages_skipped: 0,
    pages_below_threshold: 0,
    pages_archived: 0,
    links_written: 0,
    scoped_pass: dirtyScope ? 1 : 0,
  };

  // -- Mirror reads (grounded observations rows only) -----------------------
  const scopeFilter = dirtyScope
    ? sql` AND canonical_entity_id IN (${sql.join(
        dirtyScope.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;
  const entityRows = rowsOf<MirrorEntityRow>(
    await db.execute(sql`
			SELECT id, label, normalized_label, ontology_type_slug,
			       canonical_entity_id, summary, aliases
			FROM kg.entities
			WHERE tenant_id = ${args.tenantId}
			  AND source_kind = ${GRAPH_SOURCE_KIND}
			  AND grounding_status = 'grounded'${scopeFilter}
			ORDER BY normalized_label ASC, id ASC
		`),
  );
  metrics.entities_seen = entityRows.length;

  const relationshipRows = rowsOf<MirrorRelationshipRow>(
    await db.execute(sql`
			SELECT r.id, r.label, r.source_entity_id, r.target_entity_id,
			       se.label AS from_label, te.label AS to_label
			FROM kg.relationships r
			JOIN kg.entities se ON se.id = r.source_entity_id
			JOIN kg.entities te ON te.id = r.target_entity_id
			WHERE r.tenant_id = ${args.tenantId}
			  AND r.source_kind = ${GRAPH_SOURCE_KIND}
			  AND r.grounding_status = 'grounded'
			ORDER BY se.normalized_label ASC, te.normalized_label ASC, r.label ASC, r.id ASC
		`),
  );
  metrics.relationships_seen = relationshipRows.length;

  const evidenceRows = rowsOf<MirrorEvidenceRow>(
    await db.execute(sql`
			SELECT entity_id, relationship_id, evidence_source_ref, thread_id, metadata
			FROM kg.evidence
			WHERE tenant_id = ${args.tenantId}
			  AND source_kind = ${GRAPH_SOURCE_KIND}
			  AND evidence_source_kind = 'hindsight_observation'
			  AND evidence_source_ref IS NOT NULL
			ORDER BY created_at ASC, id ASC
		`),
  );

  const observationIdsByEntity = new Map<string, string[]>();
  const observationIdsByRelationship = new Map<string, string[]>();
  const claimIdsByEntity = new Map<string, string[]>();
  for (const row of evidenceRows) {
    const claimIds = Array.isArray(row.metadata?.claimIds)
      ? (row.metadata!.claimIds as unknown[]).filter(
          (id): id is string => typeof id === "string",
        )
      : [];
    if (row.entity_id) {
      const list = observationIdsByEntity.get(row.entity_id) ?? [];
      list.push(row.evidence_source_ref);
      observationIdsByEntity.set(row.entity_id, list);
      if (claimIds.length > 0) {
        claimIdsByEntity.set(row.entity_id, [
          ...(claimIdsByEntity.get(row.entity_id) ?? []),
          ...claimIds,
        ]);
      }
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

  // -- Evidence-threshold promotion gate (R7/R9, KTD-7) ---------------------
  // Distinctness key: thread when the evidence row carries one, otherwise
  // the backing observation — "mentioned across enough distinct places".
  const evidenceKeysByEntity = new Map<string, Set<string>>();
  for (const row of evidenceRows) {
    if (!row.entity_id) continue;
    const key = row.thread_id ?? row.evidence_source_ref;
    const set = evidenceKeysByEntity.get(row.entity_id) ?? new Set<string>();
    set.add(key);
    evidenceKeysByEntity.set(row.entity_id, set);
  }
  const adjacency = new Map<string, string[]>();
  for (const rel of relationshipRows) {
    if (rel.source_entity_id !== rel.target_entity_id) {
      adjacency.set(rel.source_entity_id, [
        ...(adjacency.get(rel.source_entity_id) ?? []),
        rel.target_entity_id,
      ]);
      adjacency.set(rel.target_entity_id, [
        ...(adjacency.get(rel.target_entity_id) ?? []),
        rel.source_entity_id,
      ]);
    }
  }
  const promotedEntityIds = computePromotedEntityIds({
    entityIds: entityRows.map((entity) => entity.id),
    evidenceKeysByEntity,
    adjacency,
  });

  // -- Canonical partitioning ------------------------------------------------
  // One page per canonical entity id; legacy rows (NULL canonical) fall back
  // to one slug-keyed page each. A canonical group promotes when ANY member
  // row is promoted.
  interface PageGroup {
    canonicalEntityId: string | null;
    members: MirrorEntityRow[];
  }
  const groupsByCanonical = new Map<string, PageGroup>();
  const legacyGroups: PageGroup[] = [];
  for (const entity of entityRows) {
    if (entity.canonical_entity_id) {
      const group = groupsByCanonical.get(entity.canonical_entity_id) ?? {
        canonicalEntityId: entity.canonical_entity_id,
        members: [],
      };
      group.members.push(entity);
      groupsByCanonical.set(entity.canonical_entity_id, group);
    } else {
      legacyGroups.push({ canonicalEntityId: null, members: [entity] });
    }
  }
  const groups = [...groupsByCanonical.values(), ...legacyGroups];

  // -- Page materialization (canonical-keyed upserts, deterministic slugs) --
  const pageIdBySlug = new Map<string, string>();
  const pageIdByEntityId = new Map<string, string>();

  for (const group of groups) {
    // Promotion controls the wiki window, not agent visibility (R9):
    // sub-threshold entities stay fully queryable in the KG; they simply
    // emit no page. Demotion is handled by the reconciliation pass below —
    // pages that drop below threshold archive (never delete), and the
    // canonical REGISTRY row is untouched either way.
    if (!group.members.some((member) => promotedEntityIds.has(member.id))) {
      metrics.pages_below_threshold += 1;
      continue;
    }
    // Primary member drives label/summary: most distinct evidence wins.
    const primary = [...group.members].sort(
      (a, b) =>
        (evidenceKeysByEntity.get(b.id)?.size ?? 0) -
        (evidenceKeysByEntity.get(a.id)?.size ?? 0),
    )[0]!;
    const slug = slugifyTitle(primary.label);
    if (!slug) {
      metrics.pages_skipped += 1;
      continue;
    }

    const memberIds = group.members.map((member) => member.id);
    const entityObservationIds = dedupeCap(
      memberIds.flatMap((id) => observationIdsByEntity.get(id) ?? []),
      MAX_SECTION_SOURCES,
    );
    const entityClaimIds = dedupeCap(
      memberIds.flatMap((id) => claimIdsByEntity.get(id) ?? []),
      MAX_SECTION_SOURCES,
    );
    const entityRelationships = memberIds.flatMap(
      (id) => relationshipsByEntity.get(id) ?? [],
    );

    const sections: WikiSectionInput[] = [
      {
        section_slug: "overview",
        heading: "Overview",
        body_md:
          primary.summary?.trim() ||
          `${primary.label} is tracked in the tenant knowledge graph.`,
        position: 0,
        sources: [
          ...entityObservationIds.map((ref) => ({
            kind: "hindsight_observation" as const,
            ref,
          })),
          // Durable claim provenance (U4): stable claim-ledger ids ride
          // section_sources so one source can retract without deleting
          // corroborated text (the ledger, not prose, is authoritative).
          ...entityClaimIds.map((ref) => ({
            kind: "claim" as const,
            ref,
          })),
        ],
        replaceSourceKinds: ["hindsight_observation", "claim"],
      },
    ];

    if (entityRelationships.length > 0) {
      const relationshipObservationIds = dedupeCap(
        entityRelationships.flatMap(
          (rel) => observationIdsByRelationship.get(rel.id) ?? [],
        ),
        MAX_SECTION_SOURCES,
      );
      const seenRelLines = new Set<string>();
      const relLines: string[] = [];
      for (const rel of entityRelationships) {
        const line = `- ${rel.from_label} — ${rel.label} — ${rel.to_label}`;
        if (seenRelLines.has(line)) continue;
        seenRelLines.add(line);
        relLines.push(line);
      }
      sections.push({
        section_slug: "relationships",
        heading: "Relationships",
        body_md: relLines.join("\n"),
        position: 1,
        sources: relationshipObservationIds.map((ref) => ({
          kind: "hindsight_observation" as const,
          ref,
        })),
        replaceSourceKinds: ["hindsight_observation"],
      });
    }

    const aliases = [
      ...seedAliasesForTitle(primary.label),
      ...group.members.flatMap((member) => member.aliases ?? []),
    ].map((alias) => ({ alias, source: "compiler" }));

    let pageId: string;
    let pageSlug: string;
    if (group.canonicalEntityId) {
      const page = await upsertCanonicalEntityPage(
        {
          tenant_id: args.tenantId,
          canonical_entity_id: group.canonicalEntityId,
          entity_subtype: primary.ontology_type_slug ?? null,
          slug,
          title: primary.label,
          summary: primary.summary ?? null,
          sections,
          aliases,
        },
        db,
      );
      pageId = page.id;
      pageSlug = page.slug;
    } else {
      const page = await upsertPage(
        {
          tenant_id: args.tenantId,
          owner_id: null, // tenant scope
          type: "entity",
          entity_subtype: primary.ontology_type_slug ?? null,
          slug,
          title: primary.label,
          summary: primary.summary ?? null,
          markCompiled: true,
          sections,
          aliases,
        },
        db,
      );
      pageId = page.id;
      pageSlug = page.slug;
    }

    if (!pageIdBySlug.has(pageSlug)) {
      metrics.pages_upserted += 1;
      pageIdBySlug.set(pageSlug, pageId);
    }
    for (const member of group.members) {
      pageIdByEntityId.set(member.id, pageId);
    }
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
  // FULL passes only — a dirty-scoped pass sees a subset of live slugs and
  // would archive everything else. Archiving never touches the canonical
  // registry row (identity.canonical_entities survives page demotion).
  if (!dirtyScope) {
    const materializedPages = await listGraphMaterializedTenantPages(
      { tenantId: args.tenantId },
      db,
    );
    const liveSlugs = new Set(pageIdBySlug.keys());
    const staleIds = materializedPages
      .filter((page) => page.type === "entity" && !liveSlugs.has(page.slug))
      .map((page) => page.id);
    if (staleIds.length > 0) {
      metrics.pages_archived = await archivePagesByIds(
        { pageIds: staleIds },
        db,
      );
    }
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
    // Dirty canonical scope rides the job's input jsonb (set by the ingest
    // enqueue; unioned across deduped enqueues). NULL input = full pass —
    // the rebuild path and the safety default.
    const dirtyCanonicalEntityIds = parseDirtyCanonicalEntityIds(job.input);
    const { metrics } = await materializeTenantWikiFromGraph(
      { tenantId: job.tenant_id, dirtyCanonicalEntityIds },
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
