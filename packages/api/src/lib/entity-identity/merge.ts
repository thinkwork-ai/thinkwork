/**
 * Guarded canonical-entity merge (THINK-193 U4).
 *
 * Repair tool for duplicate canonical entities/pages — deliberately NOT a
 * general MDM workbench (no Split in V1). One transaction:
 *
 *   - entity_source_mappings + entity_identity_claims repoint to the survivor;
 *   - memory_claims.canonical_subject_id repoints;
 *   - knowledge_graph_entities.canonical_entity_id repoints;
 *   - the loser's tenant Entity wiki page archives; its slug + title become
 *     survivor-page aliases (the partial unique on (tenant, canonical) means
 *     the survivor keeps at most one live page);
 *   - the loser keeps its UUID as a redirect: status='merged',
 *     merged_into_id=survivor (CHECK-enforced pairing);
 *   - an entity_resolution_events 'merge' audit row appends.
 *
 * The impact preview is computed BEFORE the merge and the caller must echo
 * it back (`confirmImpact`) — a stale preview (counts moved between preview
 * and confirm) aborts instead of silently merging more than the operator saw.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  canonicalEntities,
  entityIdentityClaims,
  entitySourceMappings,
  knowledgeGraphEntities,
  memoryClaims,
  wikiPageAliases,
  wikiPages,
} from "@thinkwork/database-pg/schema";
import type { Database } from "../db.js";
import { normalizeAlias } from "../wiki/repository.js";
import type { IdentityDbClient } from "./matcher.js";
import { appendResolutionEvent } from "./resolution.js";

export interface MergeImpactPreview {
  sourceMappingCount: number;
  identityClaimCount: number;
  memoryClaimCount: number;
  graphEntityCount: number;
  loserWikiPageId: string | null;
  loserWikiPageSlug: string | null;
  survivorWikiPageId: string | null;
}

export interface MergeCanonicalEntitiesArgs {
  tenantId: string;
  survivorId: string;
  loserId: string;
  actorUserId: string | null;
  /** Echo of the preview shown to the operator — must match at commit time. */
  confirmImpact: MergeImpactPreview;
}

export interface MergeCanonicalEntitiesResult {
  survivorId: string;
  loserId: string;
  impact: MergeImpactPreview;
}

/** Pure comparison used to guard against stale previews. */
export function impactMatches(
  a: MergeImpactPreview,
  b: MergeImpactPreview,
): boolean {
  return (
    a.sourceMappingCount === b.sourceMappingCount &&
    a.identityClaimCount === b.identityClaimCount &&
    a.memoryClaimCount === b.memoryClaimCount &&
    a.graphEntityCount === b.graphEntityCount &&
    a.loserWikiPageId === b.loserWikiPageId &&
    a.survivorWikiPageId === b.survivorWikiPageId
  );
}

/** Pure precondition guard — throws with an operator-readable message. */
export function validateMergePreconditions(args: {
  survivorId: string;
  loserId: string;
  survivor: { status: string; entity_type_slug: string } | null;
  loser: { status: string; entity_type_slug: string } | null;
}): void {
  if (args.survivorId === args.loserId) {
    throw new Error("Merge requires two distinct canonical entities");
  }
  if (!args.survivor) throw new Error("Survivor canonical entity not found");
  if (!args.loser) throw new Error("Loser canonical entity not found");
  if (args.survivor.status !== "active") {
    throw new Error(`Survivor is ${args.survivor.status}, not active`);
  }
  if (args.loser.status !== "active") {
    throw new Error(`Loser is ${args.loser.status}, not active`);
  }
  if (args.survivor.entity_type_slug !== args.loser.entity_type_slug) {
    throw new Error(
      "Cannot merge canonical entities of different ontology types",
    );
  }
}

async function loadEntity(
  db: IdentityDbClient,
  tenantId: string,
  id: string,
): Promise<{
  id: string;
  status: string;
  entity_type_slug: string;
  display_name: string;
} | null> {
  const [row] = await db
    .select({
      id: canonicalEntities.id,
      status: canonicalEntities.status,
      entity_type_slug: canonicalEntities.entity_type_slug,
      display_name: canonicalEntities.display_name,
    })
    .from(canonicalEntities)
    .where(
      and(
        eq(canonicalEntities.id, id),
        eq(canonicalEntities.tenant_id, tenantId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findTenantEntityPage(
  db: IdentityDbClient,
  tenantId: string,
  canonicalEntityId: string,
): Promise<{ id: string; slug: string; title: string } | null> {
  const [row] = await db
    .select({
      id: wikiPages.id,
      slug: wikiPages.slug,
      title: wikiPages.title,
    })
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.tenant_id, tenantId),
        eq(wikiPages.type, "entity"),
        eq(wikiPages.canonical_entity_id, canonicalEntityId),
        sql`${wikiPages.owner_id} IS NULL`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function computeMergeImpact(
  db: IdentityDbClient,
  args: { tenantId: string; survivorId: string; loserId: string },
): Promise<MergeImpactPreview> {
  const survivor = await loadEntity(db, args.tenantId, args.survivorId);
  const loser = await loadEntity(db, args.tenantId, args.loserId);
  validateMergePreconditions({
    survivorId: args.survivorId,
    loserId: args.loserId,
    survivor,
    loser,
  });

  const countOf = async (query: Promise<Array<{ count: number }>>) =>
    Number((await query)[0]?.count ?? 0);

  const sourceMappingCount = await countOf(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(entitySourceMappings)
      .where(eq(entitySourceMappings.canonical_entity_id, args.loserId)),
  );
  const identityClaimCount = await countOf(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(entityIdentityClaims)
      .where(eq(entityIdentityClaims.canonical_entity_id, args.loserId)),
  );
  const memoryClaimCount = await countOf(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(memoryClaims)
      .where(eq(memoryClaims.canonical_subject_id, args.loserId)),
  );
  const graphEntityCount = await countOf(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeGraphEntities)
      .where(eq(knowledgeGraphEntities.canonical_entity_id, args.loserId)),
  );
  const loserPage = await findTenantEntityPage(db, args.tenantId, args.loserId);
  const survivorPage = await findTenantEntityPage(
    db,
    args.tenantId,
    args.survivorId,
  );

  return {
    sourceMappingCount,
    identityClaimCount,
    memoryClaimCount,
    graphEntityCount,
    loserWikiPageId: loserPage?.id ?? null,
    loserWikiPageSlug: loserPage?.slug ?? null,
    survivorWikiPageId: survivorPage?.id ?? null,
  };
}

export async function mergeCanonicalEntities(
  db: Database,
  args: MergeCanonicalEntitiesArgs,
): Promise<MergeCanonicalEntitiesResult> {
  return db.transaction(async (tx) => {
    const survivor = await loadEntity(tx, args.tenantId, args.survivorId);
    const loser = await loadEntity(tx, args.tenantId, args.loserId);
    validateMergePreconditions({
      survivorId: args.survivorId,
      loserId: args.loserId,
      survivor,
      loser,
    });

    // Recompute impact INSIDE the transaction and require it to match the
    // preview the operator confirmed — stale previews abort.
    const impact = await computeMergeImpact(tx, {
      tenantId: args.tenantId,
      survivorId: args.survivorId,
      loserId: args.loserId,
    });
    if (!impactMatches(impact, args.confirmImpact)) {
      throw new Error(
        "Merge impact changed since preview — refresh and confirm again",
      );
    }

    const now = new Date();

    await tx
      .update(entitySourceMappings)
      .set({ canonical_entity_id: args.survivorId })
      .where(eq(entitySourceMappings.canonical_entity_id, args.loserId));

    await tx
      .update(entityIdentityClaims)
      .set({ canonical_entity_id: args.survivorId, updated_at: now })
      .where(eq(entityIdentityClaims.canonical_entity_id, args.loserId));

    await tx
      .update(memoryClaims)
      .set({ canonical_subject_id: args.survivorId, updated_at: now })
      .where(eq(memoryClaims.canonical_subject_id, args.loserId));

    await tx
      .update(knowledgeGraphEntities)
      .set({ canonical_entity_id: args.survivorId, updated_at: now })
      .where(eq(knowledgeGraphEntities.canonical_entity_id, args.loserId));

    // Wiki convergence: archive the loser's tenant Entity page; its slug and
    // title live on as survivor aliases so links keep resolving. The loser
    // page keeps canonical_entity_id = loser (a merged registry row persists
    // as the redirect), so the survivor's partial-unique slot stays single.
    if (impact.loserWikiPageId) {
      const loserPage = await findTenantEntityPage(
        tx,
        args.tenantId,
        args.loserId,
      );
      await tx
        .update(wikiPages)
        .set({ status: "archived", updated_at: now })
        .where(eq(wikiPages.id, impact.loserWikiPageId));
      if (impact.survivorWikiPageId && loserPage) {
        const aliases = new Set(
          [loserPage.slug, normalizeAlias(loserPage.title)].filter(Boolean),
        );
        for (const alias of aliases) {
          await tx
            .insert(wikiPageAliases)
            .values({
              page_id: impact.survivorWikiPageId,
              alias,
              source: "compiler",
            })
            .onConflictDoNothing();
        }
      }
    }

    await tx
      .update(canonicalEntities)
      .set({
        status: "merged",
        merged_into_id: args.survivorId,
        version: sql`${canonicalEntities.version} + 1`,
        updated_at: now,
      })
      .where(eq(canonicalEntities.id, args.loserId));

    await tx
      .update(canonicalEntities)
      .set({
        version: sql`${canonicalEntities.version} + 1`,
        updated_at: now,
      })
      .where(eq(canonicalEntities.id, args.survivorId));

    await appendResolutionEvent(tx, {
      tenantId: args.tenantId,
      caseId: null,
      canonicalEntityId: args.survivorId,
      eventType: "merge",
      actorUserId: args.actorUserId,
      payload: {
        loserId: args.loserId,
        impact: impact as unknown as Record<string, unknown>,
      },
    });

    return { survivorId: args.survivorId, loserId: args.loserId, impact };
  });
}
