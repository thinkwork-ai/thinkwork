/**
 * THINK-263 U5 — the entity dossier: server-side assembly of everything the
 * tenant brain knows about ONE grounded knowledge-graph entity (its compiled
 * wiki page, contributing memories, linked threads, and artifacts).
 *
 * A lib-level module mirroring `lib/search/broker.ts`: the GraphQL resolver is
 * a thin identity/scope shim over this function so a future agent tool can call
 * the same assembly. Two hard invariants:
 *
 *   1. Permission-fenced. Threads the caller cannot open are resolved through
 *      the SAME predicates the thread list uses (`callerVisibleThreadPredicate`
 *      + `visibleThreadListPredicate` + archived filter). Everything that hangs
 *      off a thread — the thread itself, artifacts produced in it, and memory
 *      hits stamped with it — is dropped when the thread is inaccessible. A
 *      memory hit with no stamped thread is own-bank content and kept. A
 *      service caller with no owning user has an empty accessible set AND no
 *      memory bank, so it sees threads/artifacts/memories all empty.
 *
 *   2. Degrade-aware. Grounding, not the wiki, is the source of truth for the
 *      entity. An entity with no compiled page (or no canonical identity)
 *      yields `wikiPage: null` — never a slug-fabricated fallback — while the
 *      rest of the dossier still assembles.
 *
 * Disambiguation: >1 grounded match with no `entityId` selector returns a
 * candidate list and assembles nothing; an `entityId` selects one candidate.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { artifacts, kgEntities, threads } from "@thinkwork/database-pg/schema";

import type { Database } from "../db.js";
import { getMemoryServices } from "../memory/index.js";
import { searchKnowledgeGraph } from "../knowledge-graph/graph-search.js";
import {
  findReadablePageByCanonicalEntity,
  type WikiReadScope,
} from "../wiki/repository.js";
import { toGraphQLPage, type GraphQLWikiPage } from "../wiki/mappers.js";
import { callerVisibleThreadPredicate } from "../../graphql/resolvers/threads/access.js";
import { visibleThreadListPredicate } from "../../graphql/resolvers/threads/system-hidden.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export interface DossierEntityHit {
  entityId: string;
  label: string;
  ontologyTypeSlug: string | null;
  summary: string | null;
  aliases: string[] | null;
  relationshipCount: number | null;
  evidenceCount: number | null;
}

export interface DossierThreadHit {
  id: string;
  identifier: string | null;
  title: string | null;
  spaceId: string | null;
  updatedAt: string | null;
}

export interface DossierMemoryHit {
  memoryRecordId: string;
  text: string;
  score: number | null;
  threadId: string | null;
  createdAt: string | null;
}

export interface DossierArtifact {
  id: string;
  title: string | null;
  type: string | null;
  threadId: string | null;
}

export interface EntityDossier {
  entityId: string;
  label: string;
  ontologyTypeSlug: string | null;
  summary: string | null;
  aliases: string[] | null;
  /** Null when the entity has no compiled Entity page (degrade path). */
  wikiPage: GraphQLWikiPage | null;
  /**
   * Twin routing identity (THINK-327 U7): Explorer detail route params.
   * Both null when the match has no canonical identity.
   */
  canonicalEntityId: string | null;
  entityType: string | null;
  /**
   * Company Brain U8 dual-read consult: true when the tenant/type has
   * flipped to the projected page (sections declared + first sync done) —
   * consumers fetch `twinEntityPage` for the living sections; the compiled
   * wikiPage above remains the fallback and is never fabricated.
   */
  twinProjected: boolean;
  memories: DossierMemoryHit[];
  threads: DossierThreadHit[];
  artifacts: DossierArtifact[];
}

export interface EntityDossierResult {
  /** The assembled dossier, or null when ambiguous / no grounded match. */
  match: EntityDossier | null;
  /** >1 grounded candidate and no `entityId` selector; empty once resolved. */
  disambiguation: DossierEntityHit[];
}

export interface AssembleEntityDossierArgs {
  db: Database;
  tenantId: string;
  query: string;
  /** Selects one candidate when the grounded search returns several. */
  entityId?: string | null;
  /** Null only for service callers with no owning user. */
  callerUserId: string | null;
  /** Wiki union read scope, resolved by the caller (resolver or tool host). */
  wikiScope: WikiReadScope;
  limit?: number | null;
}

interface ChosenEntity {
  id: string;
  label: string;
  typeSlug: string | null;
  summary: string | null;
  aliases: string[];
  relationshipCount: number;
  evidenceCount: number;
}

function toEntityHit(e: ChosenEntity): DossierEntityHit {
  return {
    entityId: e.id,
    label: e.label,
    ontologyTypeSlug: e.typeSlug ?? null,
    summary: e.summary ?? null,
    aliases: e.aliases ?? null,
    relationshipCount: e.relationshipCount ?? null,
    evidenceCount: e.evidenceCount ?? null,
  };
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

const EMPTY_RESULT: EntityDossierResult = { match: null, disambiguation: [] };

export async function assembleEntityDossier(
  args: AssembleEntityDossierArgs,
): Promise<EntityDossierResult> {
  const query = args.query.trim();
  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  if (query.length === 0) return EMPTY_RESULT;

  // 1) Grounded candidates (grounding_status='grounded' AND
  //    source_kind='observations' — enforced inside searchKnowledgeGraph).
  const { entities } = await searchKnowledgeGraph({
    db: args.db,
    tenantId: args.tenantId,
    query,
    limit,
  });

  let chosen: ChosenEntity | undefined;
  if (args.entityId) {
    // An explicit selector resolves an earlier disambiguation / rail pick. It is
    // usually in the grounded set for this query, but ranking/limit drift means
    // a valid pick can fall outside the top N — so fall back to a direct,
    // grounded, same-tenant lookup rather than returning nothing (which reads in
    // the palette as "the click did nothing"). Still never trusts an ungrounded
    // or cross-tenant id.
    chosen =
      entities.find((e) => e.id === args.entityId) ??
      (await fetchGroundedEntityById(args.db, args.tenantId, args.entityId));
    if (!chosen) return EMPTY_RESULT;
  } else if (entities.length > 1) {
    return { match: null, disambiguation: entities.map(toEntityHit) };
  } else if (entities.length === 1) {
    chosen = entities[0];
  } else {
    return EMPTY_RESULT;
  }

  // 2) Canonical identity — searchKnowledgeGraph does not select it. Evidence
  //    keys on the per-thread MIRROR entity id, not the canonical id, so we
  //    need both the canonical id (for the wiki page) and every mirror id that
  //    shares it (for evidence fan-out).
  const identity = await fetchCanonicalIdentity(
    args.db,
    args.tenantId,
    chosen.id,
  );
  const canonicalEntityId = identity?.canonical_entity_id ?? null;

  // 3) Wiki page (degrade-aware): only tenant Entity pages carry a canonical
  //    id. No canonical id, or no readable page, → null.
  let wikiPage: GraphQLWikiPage | null = null;
  let wikiPageId: string | null = null;
  if (canonicalEntityId) {
    const pageRow = await findReadablePageByCanonicalEntity(
      {
        tenantId: args.tenantId,
        canonicalEntityId,
        scope: args.wikiScope,
      },
      args.db,
    );
    if (pageRow) {
      wikiPage = toGraphQLPage(pageRow, { sections: [], aliases: [] });
      wikiPageId = pageRow.id;
    }
  }

  // 3b) Dual-read gate consult (Company Brain U8 / AE8): flag — never
  // replace — so consumers can fetch the projected page while the compiled
  // page stays the fallback. Best-effort: a gate error means not projected.
  let twinProjected = false;
  if (canonicalEntityId && chosen.typeSlug) {
    try {
      const { resolveTwinPageGate } = await import("../twin/dual-read-gate.js");
      // Uses the module-level db (not the caller's) so the injected fake
      // dbs in dossier tests keep their FIFO select queues aligned; the
      // catch below makes any resolution failure read as not-projected.
      const gate = await resolveTwinPageGate({
        tenantId: args.tenantId,
        entityTypeSlug: chosen.typeSlug,
      });
      twinProjected = gate.projected;
    } catch {
      twinProjected = false;
    }
  }

  // 4) Evidence → candidate thread ids. Fan out across every mirror entity id
  //    sharing the canonical id (or just the matched id when it has none).
  const mirrorEntityIds = canonicalEntityId
    ? await fetchMirrorEntityIds(args.db, args.tenantId, canonicalEntityId)
    : [chosen.id];
  const evidenceEntityIds = mirrorEntityIds.includes(chosen.id)
    ? mirrorEntityIds
    : [...mirrorEntityIds, chosen.id];
  // Two thread sources, per the plan: knowledge-graph evidence stamped with a
  // thread, AND the entity's compiled wiki-page sections' source_thread_ids
  // (U2). Both only carry threads for thread-message-derived provenance, so
  // they are empty for observation/claim-grounded brains (e.g. dev) but light
  // up on real tenants — union them, then permission-fence the whole set.
  const [evidenceThreadIds, sectionThreadIds] = await Promise.all([
    fetchEvidenceThreadIds(args.db, args.tenantId, evidenceEntityIds),
    wikiPageId
      ? fetchWikiSectionThreadIds(args.db, wikiPageId)
      : Promise.resolve([]),
  ]);
  const candidateThreadIds = Array.from(
    new Set([...evidenceThreadIds, ...sectionThreadIds]),
  );

  // 5) Permission-filter threads: resolve the accessible set AND the display
  //    fields in one pass, reusing the thread-list predicates verbatim. A
  //    service caller with no user id can open nothing.
  const accessibleThreads =
    args.callerUserId && candidateThreadIds.length > 0
      ? await fetchAccessibleThreads(
          args.db,
          args.tenantId,
          args.callerUserId,
          candidateThreadIds,
        )
      : [];
  const accessibleThreadIds = new Set(accessibleThreads.map((t) => t.id));

  // 6) Memories (own bank), dropping hits whose stamped thread is inaccessible.
  const memories = await assembleMemories(
    args,
    query,
    limit,
    accessibleThreadIds,
  );

  // 7) Artifacts join by accessible thread — there is no entity FK.
  const dossierArtifacts =
    accessibleThreadIds.size > 0
      ? await fetchArtifacts(args.db, args.tenantId, [...accessibleThreadIds])
      : [];

  return {
    match: {
      entityId: chosen.id,
      label: chosen.label,
      ontologyTypeSlug: chosen.typeSlug ?? null,
      summary: chosen.summary ?? null,
      aliases: chosen.aliases ?? null,
      wikiPage,
      // Twin routing identity (THINK-327 U7): the Explorer detail route
      // takes entityType + canonicalEntityId — already resolved above for
      // the wiki-page lookup and the dual-read gate.
      canonicalEntityId,
      entityType: canonicalEntityId ? (chosen.typeSlug ?? null) : null,
      twinProjected,
      memories,
      threads: accessibleThreads,
      artifacts: dossierArtifacts,
    },
    disambiguation: [],
  };
}

async function fetchGroundedEntityById(
  db: Database,
  tenantId: string,
  entityId: string,
): Promise<ChosenEntity | undefined> {
  const result = await db.execute(sql`
    SELECT id, label, ontology_type_slug, summary, aliases,
           relationship_count, evidence_count
      FROM ${kgEntities}
     WHERE id = ${entityId}
       AND tenant_id = ${tenantId}
       AND grounding_status = 'grounded'
     LIMIT 1
  `);
  const row = rowsOf<{
    id: string;
    label: string;
    ontology_type_slug: string | null;
    summary: string | null;
    aliases: string[] | null;
    relationship_count: number | null;
    evidence_count: number | null;
  }>(result)[0];
  if (!row) return undefined;
  return {
    id: row.id,
    label: row.label,
    typeSlug: row.ontology_type_slug ?? null,
    summary: row.summary ?? null,
    aliases: row.aliases ?? [],
    relationshipCount: row.relationship_count ?? 0,
    evidenceCount: row.evidence_count ?? 0,
  };
}

async function fetchCanonicalIdentity(
  db: Database,
  tenantId: string,
  entityId: string,
): Promise<{
  canonical_entity_id: string | null;
  resolution_state: string | null;
} | null> {
  const result = await db.execute(sql`
    SELECT canonical_entity_id, resolution_state
      FROM ${kgEntities}
     WHERE id = ${entityId}
       AND tenant_id = ${tenantId}
     LIMIT 1
  `);
  return (
    rowsOf<{
      canonical_entity_id: string | null;
      resolution_state: string | null;
    }>(result)[0] ?? null
  );
}

async function fetchMirrorEntityIds(
  db: Database,
  tenantId: string,
  canonicalEntityId: string,
): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT id
      FROM ${kgEntities}
     WHERE tenant_id = ${tenantId}
       AND canonical_entity_id = ${canonicalEntityId}
  `);
  return rowsOf<{ id: string }>(result).map((r) => r.id);
}

async function fetchEvidenceThreadIds(
  db: Database,
  tenantId: string,
  entityIds: string[],
): Promise<string[]> {
  if (entityIds.length === 0) return [];
  const idList = sql.join(
    entityIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  // NEVER select the `snippet` column — it carries raw per-user memory text
  // past the promotion gate and is admin-only (Explorer).
  const result = await db.execute(sql`
    SELECT DISTINCT thread_id
      FROM kg.evidence
     WHERE tenant_id = ${tenantId}
       AND entity_id IN (${idList})
       AND thread_id IS NOT NULL
  `);
  return rowsOf<{ thread_id: string }>(result)
    .map((r) => r.thread_id)
    .filter((id): id is string => !!id);
}

async function fetchWikiSectionThreadIds(
  db: Database,
  wikiPageId: string,
): Promise<string[]> {
  // Thread backpointers stamped onto the page's section provenance (U2).
  const result = await db.execute(sql`
    SELECT DISTINCT unnest(ss.source_thread_ids) AS thread_id
      FROM wiki.section_sources ss
      JOIN wiki.page_sections ps ON ps.id = ss.section_id
     WHERE ps.page_id = ${wikiPageId}
       AND ss.source_thread_ids IS NOT NULL
  `);
  return rowsOf<{ thread_id: string | null }>(result)
    .map((r) => r.thread_id)
    .filter((id): id is string => !!id);
}

async function fetchAccessibleThreads(
  db: Database,
  tenantId: string,
  callerUserId: string,
  candidateThreadIds: string[],
): Promise<DossierThreadHit[]> {
  const rows = await db
    .select({
      id: threads.id,
      title: threads.title,
      identifier: threads.identifier,
      space_id: threads.space_id,
      updated_at: threads.updated_at,
    })
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, tenantId),
        inArray(threads.id, candidateThreadIds),
        callerVisibleThreadPredicate(tenantId, callerUserId),
        visibleThreadListPredicate(),
        sql`${threads.archived_at} IS NULL`,
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    identifier: r.identifier ?? null,
    title: r.title ?? null,
    spaceId: r.space_id ?? null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }));
}

async function assembleMemories(
  args: AssembleEntityDossierArgs,
  query: string,
  limit: number,
  accessibleThreadIds: Set<string>,
): Promise<DossierMemoryHit[]> {
  // Memory banks are per-user; a service caller has no bank to read.
  if (!args.callerUserId) return [];
  const { recall } = getMemoryServices();
  const hits = await recall.recall({
    tenantId: args.tenantId,
    ownerType: "user",
    ownerId: args.callerUserId,
    query,
    limit,
    requestContext: {
      contextClass: "memory_search",
      requesterUserId: args.callerUserId,
      sourceSurface: "entity_dossier",
    },
  });

  const mapped: DossierMemoryHit[] = hits.map((h) => ({
    memoryRecordId: h.record.id,
    text: h.record.content.text,
    score: typeof h.score === "number" ? h.score : null,
    threadId: (h.record.threadId as string | undefined) ?? null,
    createdAt: h.record.createdAt ?? null,
  }));

  // Drop hits whose stamped source thread the caller cannot open; keep hits
  // with no stamped threadId (own-bank content, nothing to check).
  return mapped
    .filter((m) => !m.threadId || accessibleThreadIds.has(m.threadId))
    .slice(0, limit);
}

async function fetchArtifacts(
  db: Database,
  tenantId: string,
  accessibleThreadIds: string[],
): Promise<DossierArtifact[]> {
  const rows = await db
    .select({
      id: artifacts.id,
      title: artifacts.title,
      type: artifacts.type,
      thread_id: artifacts.thread_id,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.tenant_id, tenantId),
        inArray(artifacts.thread_id, accessibleThreadIds),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? null,
    type: r.type ?? null,
    threadId: r.thread_id ?? null,
  }));
}
