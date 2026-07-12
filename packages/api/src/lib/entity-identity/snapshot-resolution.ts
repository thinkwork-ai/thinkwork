/**
 * Canonical identity resolution for a normalized knowledge-graph snapshot
 * (THINK-193 U4). Runs between source-declared fallback and the mirror
 * merge in the observations ingest worker.
 *
 * For every GROUNDED entity (approved ontology type):
 *   - exact / auto-link / already-registered-name → canonicalEntityId +
 *     resolutionState 'resolved';
 *   - no candidates → a canonical registry row is created deterministically
 *     (createdBy 'rule') and the entity resolves;
 *   - suggestion / ambiguous → the entity (and its relationships/evidence)
 *     is EXCLUDED from the merged snapshot; an item-level deferral with the
 *     coalesced resolution-case id is recorded for the run metrics. Cursors
 *     still advance — the deferral repeats on later ingests of the same
 *     signature and coalesces onto the same open case.
 *
 * Non-grounded entities stay outside identity scope (they never publish to
 * the wiki) and keep resolutionState 'legacy'.
 */

import { eq, and } from "drizzle-orm";
import { ontologyEntityTypes } from "@thinkwork/database-pg/schema";
import type {
  NormalizedKnowledgeGraphEntity,
  NormalizedKnowledgeGraphSnapshot,
} from "../knowledge-graph/normalizer.js";
import {
  defaultIdentityRules,
  matchCanonicalEntity,
  type IdentityDbClient,
} from "./matcher.js";
import {
  applyNormalization,
  computeIdentitySignature,
  parseIdentityRules,
  type IdentityRule,
} from "./normalizers.js";
import {
  createCanonicalEntity,
  openOrCoalesceResolutionCase,
} from "./resolution.js";

export interface SnapshotIdentityDeferral {
  label: string;
  ontologyTypeSlug: string | null;
  caseId: string;
}

export interface SnapshotIdentityResolution {
  snapshot: NormalizedKnowledgeGraphSnapshot;
  deferrals: SnapshotIdentityDeferral[];
  metrics: {
    identityResolvedCount: number;
    identityCreatedCount: number;
    identityDeferredCount: number;
    identityOutOfScopeCount: number;
  };
}

/** Load approved identity rules per entity-type slug for the tenant. */
export async function loadIdentityRulesByTypeSlug(
  db: IdentityDbClient,
  tenantId: string,
): Promise<Map<string, IdentityRule[]>> {
  const rows = await db
    .select({
      slug: ontologyEntityTypes.slug,
      identity_rules: ontologyEntityTypes.identity_rules,
    })
    .from(ontologyEntityTypes)
    .where(
      and(
        eq(ontologyEntityTypes.tenant_id, tenantId),
        eq(ontologyEntityTypes.lifecycle_status, "approved"),
      ),
    );
  const bySlug = new Map<string, IdentityRule[]>();
  for (const row of rows) {
    const parsed = parseIdentityRules(row.identity_rules);
    bySlug.set(row.slug, parsed.length > 0 ? parsed : defaultIdentityRules());
  }
  return bySlug;
}

export async function resolveSnapshotCanonicalIdentity(args: {
  db: IdentityDbClient;
  tenantId: string;
  snapshot: NormalizedKnowledgeGraphSnapshot;
}): Promise<SnapshotIdentityResolution> {
  const rulesByType = await loadIdentityRulesByTypeSlug(args.db, args.tenantId);
  const deferrals: SnapshotIdentityDeferral[] = [];
  const excludedTempIds = new Set<string>();
  const metrics = {
    identityResolvedCount: 0,
    identityCreatedCount: 0,
    identityDeferredCount: 0,
    identityOutOfScopeCount: 0,
  };

  const keptEntities: NormalizedKnowledgeGraphEntity[] = [];
  for (const entity of args.snapshot.entities) {
    if (entity.groundingStatus !== "grounded" || !entity.ontologyTypeSlug) {
      metrics.identityOutOfScopeCount += 1;
      keptEntities.push(entity);
      continue;
    }
    const rules =
      rulesByType.get(entity.ontologyTypeSlug) ?? defaultIdentityRules();
    const verdict = await matchCanonicalEntity(
      args.db,
      {
        tenantId: args.tenantId,
        entityTypeSlug: entity.ontologyTypeSlug,
        displayName: entity.label,
        visibility: "tenant",
        naturalKeys: [{ keyKind: "name", rawValue: entity.label }],
      },
      rules,
    );

    if (verdict.kind === "exact" || verdict.kind === "auto_link") {
      metrics.identityResolvedCount += 1;
      keptEntities.push({
        ...entity,
        canonicalEntityId: verdict.canonicalEntityId,
        resolutionState: "resolved",
      });
      continue;
    }
    if (verdict.kind === "new") {
      const created = await createCanonicalEntity(args.db, {
        tenantId: args.tenantId,
        entityTypeSlug: entity.ontologyTypeSlug,
        displayName: entity.label,
        createdBy: "rule",
      });
      metrics.identityCreatedCount += 1;
      keptEntities.push({
        ...entity,
        canonicalEntityId: created.canonicalEntityId,
        resolutionState: "resolved",
      });
      continue;
    }

    if (verdict.kind === "private_unmapped") {
      // Unreachable with visibility 'tenant'; guard defensively — a private
      // verdict must never create shared identity or a case.
      metrics.identityOutOfScopeCount += 1;
      keptEntities.push({ ...entity, resolutionState: "private" });
      continue;
    }

    // suggestion | ambiguous — defer the item and exclude it from the merge.
    const normalizedName = applyNormalization("name", entity.label);
    const signatureHash = computeIdentitySignature({
      entityTypeSlug: entity.ontologyTypeSlug,
      keys: [{ keyKind: "name", normalizedValue: normalizedName }],
    });
    const candidates =
      verdict.kind === "ambiguous"
        ? verdict.candidates.map((candidate) => ({
            canonicalEntityId: candidate.canonicalEntityId,
            displayName: candidate.displayName,
            matchedKeyKinds: candidate.matchedKeyKinds,
          }))
        : [
            {
              canonicalEntityId: verdict.canonicalEntityId,
              displayName: null,
              matchedKeyKinds: verdict.matchedKeyKinds,
            },
          ];
    const { caseId } = await openOrCoalesceResolutionCase(args.db, {
      tenantId: args.tenantId,
      signatureHash,
      entityTypeSlug: entity.ontologyTypeSlug,
      displayHint: entity.label,
      candidates,
      conflictingClaims: [],
      pendingKeys: [
        {
          keyKind: "name",
          normalizedValue: normalizedName,
          ruleSlug: rules[0]?.slug,
          ruleVersion: rules[0]?.version,
        },
      ],
    });
    metrics.identityDeferredCount += 1;
    deferrals.push({
      label: entity.label,
      ontologyTypeSlug: entity.ontologyTypeSlug,
      caseId,
    });
    excludedTempIds.add(entity.tempId);
  }

  // Drop relationships touching excluded entities, then evidence for both.
  const keptRelationships = args.snapshot.relationships.filter(
    (relationship) =>
      !excludedTempIds.has(relationship.sourceTempId) &&
      !excludedTempIds.has(relationship.targetTempId),
  );
  const keptRelationshipTempIds = new Set(
    keptRelationships.map((relationship) => relationship.tempId),
  );
  const keptEvidence = args.snapshot.evidence.filter((evidence) => {
    if (evidence.entityTempId && excludedTempIds.has(evidence.entityTempId)) {
      return false;
    }
    if (
      evidence.relationshipTempId &&
      !keptRelationshipTempIds.has(evidence.relationshipTempId)
    ) {
      return false;
    }
    return true;
  });

  return {
    snapshot: {
      ...args.snapshot,
      entities: keptEntities,
      relationships: keptRelationships,
      evidence: keptEvidence,
    },
    deferrals,
    metrics,
  };
}
