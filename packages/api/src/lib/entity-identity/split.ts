/**
 * Guarded canonical-entity split (THINK-321 U2, AE5) — the inverse repair
 * tool to merge.ts, mirroring its preview/confirm-echo contract: the impact
 * preview is computed BEFORE the split, recomputed inside the transaction,
 * and the caller must echo it back exactly (`confirmImpact`) or the split
 * aborts instead of silently moving more than the operator saw.
 *
 * Partition model: the operator assigns each source MAPPING to half A or
 * half B. Half A keeps the original canonical id (so canonical references
 * to the entity that was "mostly right" stay stable); half B is a NEW
 * canonical entity that receives its assigned mappings.
 *
 * Claim re-attachment (studied for U2): `entity_identity_claims` has NO
 * mapping FK — claims are keyed to the canonical entity only, with a
 * source-safe `evidence` jsonb. So claims re-attach by (source_system,
 * namespace) grouping: a claim whose `evidence.sourceSystem` (+ optional
 * `evidence.namespace`) matches a source-identity group whose mappings ALL
 * moved to half B follows to B. Claims with no derivable source group, or
 * whose group is split across halves, stay on half A — conservative, and
 * re-derivable: the next ingest/drift scan re-attaches natural keys from
 * the partitioned evidence.
 *
 * Downstream surfaces keyed on canonical_entity_id (what merge repoints,
 * split deliberately does NOT):
 *   - wiki `pages` (partial-unique per (tenant, canonical) — see
 *     packages/database-pg/src/schema/wiki.ts): the tenant Entity page
 *     stays on half A; half B has no page until the next wiki compile
 *     derives one from B's partitioned evidence. Merge could repoint
 *     deterministically (N→1); split cannot (1→2 needs per-row provenance
 *     the rows don't carry), so B's surfaces re-derive on next compile.
 *   - kg.entities.canonical_entity_id and memory_claims.canonical_subject_id:
 *     graph/memory rows carry no mapping linkage, so their half is not
 *     derivable — they stay on A and re-derive on the next kg/wiki compile
 *     of the partitioned identity evidence.
 *
 * Negative evidence (AE5): the split writes `mapping_rejections` rows in
 * BOTH directions — each half-A source identity is rejected against half B
 * and vice versa — so the matcher/drift pass never immediately re-proposes
 * re-merging the pair. `split` audit events append on both halves.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  canonicalEntities,
  entityIdentityClaims,
  entitySourceMappings,
  kgEntities,
  mappingRejections,
  memoryClaims,
  wikiPages,
} from "@thinkwork/database-pg/schema";
import type { Database } from "../db.js";
import type { IdentityDbClient } from "./matcher.js";
import { applyNormalization } from "./normalizers.js";
import { appendResolutionEvent } from "./resolution.js";

export type SplitHalf = "a" | "b";

export interface SplitMappingAssignment {
  mappingId: string;
  half: SplitHalf;
}

export interface SplitImpactPreview {
  mappingCountA: number;
  mappingCountB: number;
  /** Claims following their B-only source group to the new entity. */
  claimCountFollowingB: number;
  /** Claims staying on A (no derivable source group, or group split). */
  claimCountRemainingA: number;
  /** Rows that stay on A and re-derive on the next compile (see header). */
  memoryClaimCount: number;
  graphEntityCount: number;
  wikiPageId: string | null;
}

/** Pure comparison guarding against stale previews (mirrors merge). */
export function splitImpactMatches(
  a: SplitImpactPreview,
  b: SplitImpactPreview,
): boolean {
  return (
    a.mappingCountA === b.mappingCountA &&
    a.mappingCountB === b.mappingCountB &&
    a.claimCountFollowingB === b.claimCountFollowingB &&
    a.claimCountRemainingA === b.claimCountRemainingA &&
    a.memoryClaimCount === b.memoryClaimCount &&
    a.graphEntityCount === b.graphEntityCount &&
    a.wikiPageId === b.wikiPageId
  );
}

interface MappingRow {
  id: string;
  source_system: string;
  namespace: string;
  external_id: string;
}

interface ClaimRow {
  id: string;
  evidence: Record<string, unknown>;
}

const groupKey = (sourceSystem: string, namespace: string) =>
  `${sourceSystem} ${namespace}`;

/**
 * Pure partition validation: every mapping assigned exactly once, no unknown
 * mapping ids, and both halves non-empty (all-to-one-half is not a split).
 */
export function validateSplitPartition(
  mappings: Array<{ id: string }>,
  assignments: SplitMappingAssignment[],
): void {
  const assignedById = new Map<string, SplitHalf>();
  for (const assignment of assignments) {
    if (assignedById.has(assignment.mappingId)) {
      throw new Error(
        `Split assignment lists mapping ${assignment.mappingId} more than once`,
      );
    }
    assignedById.set(assignment.mappingId, assignment.half);
  }
  const mappingIds = new Set(mappings.map((mapping) => mapping.id));
  for (const mappingId of assignedById.keys()) {
    if (!mappingIds.has(mappingId)) {
      throw new Error(
        `Split assignment references unknown mapping ${mappingId}`,
      );
    }
  }
  for (const mapping of mappings) {
    if (!assignedById.has(mapping.id)) {
      throw new Error(
        `Split assignment must cover every source mapping (missing ${mapping.id})`,
      );
    }
  }
  const halves = new Set(assignedById.values());
  if (!halves.has("a") || !halves.has("b")) {
    throw new Error("Split requires at least one source mapping on each half");
  }
}

/**
 * Pure claim re-attachment: claim ids that follow to half B. A claim follows
 * iff its evidence names a (source_system, namespace) group whose mappings
 * ALL moved to B. Everything else stays on A (conservative).
 */
export function deriveClaimFollowSet(
  mappings: MappingRow[],
  assignments: SplitMappingAssignment[],
  claims: ClaimRow[],
): Set<string> {
  const halfByMappingId = new Map(
    assignments.map((assignment) => [assignment.mappingId, assignment.half]),
  );
  const halvesByGroup = new Map<string, Set<SplitHalf>>();
  for (const mapping of mappings) {
    const key = groupKey(mapping.source_system, mapping.namespace);
    const halves = halvesByGroup.get(key) ?? new Set<SplitHalf>();
    const half = halfByMappingId.get(mapping.id);
    if (half) halves.add(half);
    halvesByGroup.set(key, halves);
  }
  const followed = new Set<string>();
  for (const claim of claims) {
    const evidence = claim.evidence ?? {};
    const sourceSystem = (evidence as { sourceSystem?: unknown }).sourceSystem;
    if (typeof sourceSystem !== "string") continue;
    const namespace = (evidence as { namespace?: unknown }).namespace;
    const key = groupKey(
      sourceSystem,
      typeof namespace === "string" ? namespace : "",
    );
    const halves = halvesByGroup.get(key);
    if (halves && halves.size === 1 && halves.has("b")) {
      followed.add(claim.id);
    }
  }
  return followed;
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

async function loadSplitContext(
  db: IdentityDbClient,
  args: {
    tenantId: string;
    canonicalEntityId: string;
    assignments: SplitMappingAssignment[];
  },
): Promise<{
  entity: {
    id: string;
    status: string;
    entity_type_slug: string;
    display_name: string;
  };
  mappings: MappingRow[];
  claims: ClaimRow[];
  claimFollowSet: Set<string>;
}> {
  const entity = await loadEntity(db, args.tenantId, args.canonicalEntityId);
  if (!entity) throw new Error("Canonical entity not found");
  if (entity.status !== "active") {
    throw new Error(`Canonical entity is ${entity.status}, not active`);
  }

  const mappings = await db
    .select({
      id: entitySourceMappings.id,
      source_system: entitySourceMappings.source_system,
      namespace: entitySourceMappings.namespace,
      external_id: entitySourceMappings.external_id,
    })
    .from(entitySourceMappings)
    .where(
      and(
        eq(entitySourceMappings.tenant_id, args.tenantId),
        eq(entitySourceMappings.canonical_entity_id, args.canonicalEntityId),
      ),
    );
  validateSplitPartition(mappings, args.assignments);

  const claims = await db
    .select({
      id: entityIdentityClaims.id,
      evidence: entityIdentityClaims.evidence,
    })
    .from(entityIdentityClaims)
    .where(
      and(
        eq(entityIdentityClaims.tenant_id, args.tenantId),
        eq(entityIdentityClaims.canonical_entity_id, args.canonicalEntityId),
        eq(entityIdentityClaims.state, "active"),
      ),
    );
  const claimFollowSet = deriveClaimFollowSet(
    mappings,
    args.assignments,
    claims,
  );
  return { entity, mappings, claims, claimFollowSet };
}

export async function previewCanonicalEntitySplit(
  db: IdentityDbClient,
  args: {
    tenantId: string;
    canonicalEntityId: string;
    assignments: SplitMappingAssignment[];
  },
): Promise<SplitImpactPreview> {
  const { claims, claimFollowSet } = await loadSplitContext(db, args);

  const countOf = async (query: Promise<Array<{ count: number }>>) =>
    Number((await query)[0]?.count ?? 0);
  const memoryClaimCount = await countOf(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(memoryClaims)
      .where(eq(memoryClaims.canonical_subject_id, args.canonicalEntityId)),
  );
  const graphEntityCount = await countOf(
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(kgEntities)
      .where(eq(kgEntities.canonical_entity_id, args.canonicalEntityId)),
  );
  const [wikiPage] = await db
    .select({ id: wikiPages.id })
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.tenant_id, args.tenantId),
        eq(wikiPages.type, "entity"),
        eq(wikiPages.canonical_entity_id, args.canonicalEntityId),
        sql`${wikiPages.owner_id} IS NULL`,
      ),
    )
    .limit(1);

  const halfCounts = { a: 0, b: 0 };
  for (const assignment of args.assignments) {
    halfCounts[assignment.half] += 1;
  }
  return {
    mappingCountA: halfCounts.a,
    mappingCountB: halfCounts.b,
    claimCountFollowingB: claimFollowSet.size,
    claimCountRemainingA: claims.length - claimFollowSet.size,
    memoryClaimCount,
    graphEntityCount,
    wikiPageId: wikiPage?.id ?? null,
  };
}

export interface SplitCanonicalEntityArgs {
  tenantId: string;
  canonicalEntityId: string;
  assignments: SplitMappingAssignment[];
  /** Display name for the new half-B canonical entity. */
  newEntityDisplayName: string;
  actorUserId: string | null;
  /** Echo of the preview shown to the operator — must match at commit time. */
  confirmImpact: SplitImpactPreview;
}

export interface SplitCanonicalEntityResult {
  entityAId: string;
  entityBId: string;
  impact: SplitImpactPreview;
}

export async function splitCanonicalEntity(
  db: Database,
  args: SplitCanonicalEntityArgs,
): Promise<SplitCanonicalEntityResult> {
  const newDisplayName = args.newEntityDisplayName.trim();
  if (!newDisplayName) {
    throw new Error("Split requires a display name for the new entity");
  }
  return db.transaction(async (tx) => {
    const { entity, mappings, claimFollowSet } = await loadSplitContext(tx, {
      tenantId: args.tenantId,
      canonicalEntityId: args.canonicalEntityId,
      assignments: args.assignments,
    });

    // Recompute impact INSIDE the transaction and require it to match the
    // preview the operator confirmed — stale previews abort (mirrors merge).
    const impact = await previewCanonicalEntitySplit(tx, {
      tenantId: args.tenantId,
      canonicalEntityId: args.canonicalEntityId,
      assignments: args.assignments,
    });
    if (!splitImpactMatches(impact, args.confirmImpact)) {
      throw new Error(
        "Split impact changed since preview — refresh and confirm again",
      );
    }

    const now = new Date();
    const halfByMappingId = new Map(
      args.assignments.map((assignment) => [
        assignment.mappingId,
        assignment.half,
      ]),
    );
    const mappingsA = mappings.filter(
      (mapping) => halfByMappingId.get(mapping.id) === "a",
    );
    const mappingsB = mappings.filter(
      (mapping) => halfByMappingId.get(mapping.id) === "b",
    );

    const [created] = await tx
      .insert(canonicalEntities)
      .values({
        tenant_id: args.tenantId,
        entity_type_slug: entity.entity_type_slug,
        display_name: newDisplayName,
        normalized_name: applyNormalization("name", newDisplayName),
      })
      .returning({ id: canonicalEntities.id });
    const entityBId = created!.id;

    await tx
      .update(entitySourceMappings)
      .set({ canonical_entity_id: entityBId })
      .where(
        inArray(
          entitySourceMappings.id,
          mappingsB.map((mapping) => mapping.id),
        ),
      );

    if (claimFollowSet.size > 0) {
      await tx
        .update(entityIdentityClaims)
        .set({ canonical_entity_id: entityBId, updated_at: now })
        .where(inArray(entityIdentityClaims.id, [...claimFollowSet]));
    }

    // Negative evidence in BOTH directions (AE5): half-A source identities
    // are rejected against B and half-B identities against A, so a drift
    // pass never immediately re-proposes re-merging the split pair.
    for (const mapping of mappingsA) {
      await tx
        .insert(mappingRejections)
        .values({
          tenant_id: args.tenantId,
          source_system: mapping.source_system,
          namespace: mapping.namespace,
          external_id: mapping.external_id,
          canonical_entity_id: entityBId,
          reason: "split",
          created_by: "operator",
        })
        .onConflictDoNothing();
    }
    for (const mapping of mappingsB) {
      await tx
        .insert(mappingRejections)
        .values({
          tenant_id: args.tenantId,
          source_system: mapping.source_system,
          namespace: mapping.namespace,
          external_id: mapping.external_id,
          canonical_entity_id: args.canonicalEntityId,
          reason: "split",
          created_by: "operator",
        })
        .onConflictDoNothing();
    }

    await tx
      .update(canonicalEntities)
      .set({
        version: sql`${canonicalEntities.version} + 1`,
        updated_at: now,
      })
      .where(eq(canonicalEntities.id, args.canonicalEntityId));

    // Split audit events on BOTH halves.
    const eventPayload = {
      counterpart: { a: args.canonicalEntityId, b: entityBId },
      mappingIdsA: mappingsA.map((mapping) => mapping.id),
      mappingIdsB: mappingsB.map((mapping) => mapping.id),
      impact: impact as unknown as Record<string, unknown>,
    };
    await appendResolutionEvent(tx, {
      tenantId: args.tenantId,
      caseId: null,
      canonicalEntityId: args.canonicalEntityId,
      eventType: "split",
      actorUserId: args.actorUserId,
      payload: eventPayload,
    });
    await appendResolutionEvent(tx, {
      tenantId: args.tenantId,
      caseId: null,
      canonicalEntityId: entityBId,
      eventType: "split",
      actorUserId: args.actorUserId,
      payload: eventPayload,
    });

    return { entityAId: args.canonicalEntityId, entityBId, impact };
  });
}
