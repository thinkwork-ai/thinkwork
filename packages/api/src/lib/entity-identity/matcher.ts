/**
 * Canonical identity matcher (THINK-193 U4).
 *
 * Verdict ladder (plan 2026-07-11-002):
 *   1. EXACT source mapping wins — one canonical entity per
 *      (source_system, namespace, external_id), merged redirects followed.
 *   2. Strong natural keys AUTO-LINK only when the approved rule says
 *      unique + autoLink AND the match is non-conflicting (exactly one
 *      distinct canonical entity across every strong key).
 *   3. Everything fuzzy / multi-match becomes a SUGGESTION or AMBIGUOUS
 *      verdict — those defer to the operator resolution queue, never link.
 *   4. NEW — no candidates at all; shared evidence may create a canonical
 *      entity deterministically.
 *
 * Private evidence may REUSE an existing exact mapping internally but a
 * private item without one is `private_unmapped`: it never creates tenant
 * mappings, canonical rows, or resolution cases (no identity side channel).
 *
 * The decision core (`decideMatch`) is pure; `matchCanonicalEntity` wraps it
 * with the Aurora lookups.
 */

import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  canonicalEntities,
  entityIdentityClaims,
  entitySourceMappings,
} from "@thinkwork/database-pg/schema";
import type { Database } from "../db.js";
import type { DatabaseTransaction } from "../knowledge-graph/repository.js";
import {
  applyNormalization,
  hashIdentityValue,
  type IdentityRule,
} from "./normalizers.js";

export type IdentityDbClient = Database | DatabaseTransaction;

export interface MatchSourceKey {
  sourceSystem: string;
  namespace?: string;
  externalId: string;
}

export interface MatchNaturalKey {
  keyKind: string;
  rawValue: string;
}

export interface MatchRequest {
  tenantId: string;
  entityTypeSlug: string;
  displayName: string;
  visibility: "tenant" | "private";
  sourceKeys?: MatchSourceKey[];
  naturalKeys?: MatchNaturalKey[];
}

export interface MatchCandidate {
  canonicalEntityId: string;
  displayName: string | null;
  matchedKeyKinds: string[];
}

export type MatchVerdict =
  | { kind: "exact"; canonicalEntityId: string }
  | { kind: "auto_link"; canonicalEntityId: string; ruleSlug: string }
  | { kind: "suggestion"; canonicalEntityId: string; matchedKeyKinds: string[] }
  | { kind: "ambiguous"; candidates: MatchCandidate[] }
  | { kind: "new" }
  | { kind: "private_unmapped" };

/** A looked-up active identity-claim match for one natural key. */
export interface ClaimMatch {
  keyKind: string;
  canonicalEntityId: string;
  canonicalDisplayName: string | null;
}

export interface NameCandidate {
  canonicalEntityId: string;
  displayName: string | null;
}

// ---------------------------------------------------------------------------
// Pure decision core
// ---------------------------------------------------------------------------

export function decideMatch(args: {
  visibility: "tenant" | "private";
  rules: IdentityRule[];
  exactCanonicalEntityId: string | null;
  claimMatches: ClaimMatch[];
  nameCandidates: NameCandidate[];
}): MatchVerdict {
  if (args.exactCanonicalEntityId) {
    return { kind: "exact", canonicalEntityId: args.exactCanonicalEntityId };
  }

  // Private evidence may only reuse exact mappings — it never key-matches
  // its way into tenant identity, and never creates anything.
  if (args.visibility === "private") {
    return { kind: "private_unmapped" };
  }

  const ruleByKeyKind = new Map(args.rules.map((rule) => [rule.keyKind, rule]));

  // -- Strong keys: unique + autoLink rules only ----------------------------
  const strongTargets = new Map<string, MatchCandidate>();
  let strongRuleSlug: string | null = null;
  for (const match of args.claimMatches) {
    const rule = ruleByKeyKind.get(match.keyKind);
    if (!rule || !rule.unique || !rule.autoLink) continue;
    const existing = strongTargets.get(match.canonicalEntityId);
    if (existing) {
      if (!existing.matchedKeyKinds.includes(match.keyKind)) {
        existing.matchedKeyKinds.push(match.keyKind);
      }
    } else {
      strongTargets.set(match.canonicalEntityId, {
        canonicalEntityId: match.canonicalEntityId,
        displayName: match.canonicalDisplayName,
        matchedKeyKinds: [match.keyKind],
      });
    }
    strongRuleSlug = strongRuleSlug ?? rule.slug;
  }
  if (strongTargets.size === 1 && strongRuleSlug) {
    // Non-conflicting: every strong key agrees on one canonical entity.
    const [target] = strongTargets.values();
    return {
      kind: "auto_link",
      canonicalEntityId: target!.canonicalEntityId,
      ruleSlug: strongRuleSlug,
    };
  }
  if (strongTargets.size > 1) {
    return { kind: "ambiguous", candidates: [...strongTargets.values()] };
  }

  // -- Weak evidence: non-strong claim matches + same-name candidates ------
  const weakTargets = new Map<string, MatchCandidate>();
  for (const match of args.claimMatches) {
    const rule = ruleByKeyKind.get(match.keyKind);
    if (rule && rule.unique && rule.autoLink) continue; // handled above
    const existing = weakTargets.get(match.canonicalEntityId);
    if (existing) {
      if (!existing.matchedKeyKinds.includes(match.keyKind)) {
        existing.matchedKeyKinds.push(match.keyKind);
      }
    } else {
      weakTargets.set(match.canonicalEntityId, {
        canonicalEntityId: match.canonicalEntityId,
        displayName: match.canonicalDisplayName,
        matchedKeyKinds: [match.keyKind],
      });
    }
  }
  for (const candidate of args.nameCandidates) {
    const existing = weakTargets.get(candidate.canonicalEntityId);
    if (existing) {
      if (!existing.matchedKeyKinds.includes("name")) {
        existing.matchedKeyKinds.push("name");
      }
    } else {
      weakTargets.set(candidate.canonicalEntityId, {
        canonicalEntityId: candidate.canonicalEntityId,
        displayName: candidate.displayName,
        matchedKeyKinds: ["name"],
      });
    }
  }

  if (weakTargets.size === 1) {
    const [target] = weakTargets.values();
    return {
      kind: "suggestion",
      canonicalEntityId: target!.canonicalEntityId,
      matchedKeyKinds: target!.matchedKeyKinds,
    };
  }
  if (weakTargets.size > 1) {
    return { kind: "ambiguous", candidates: [...weakTargets.values()] };
  }
  return { kind: "new" };
}

// ---------------------------------------------------------------------------
// DB lookups
// ---------------------------------------------------------------------------

/** Follow the merged_into_id redirect chain to the surviving canonical id. */
export async function resolveMergedRedirect(
  db: IdentityDbClient,
  tenantId: string,
  canonicalEntityId: string,
): Promise<string> {
  let currentId = canonicalEntityId;
  // Bounded walk — merge chains are operator-driven and short; the bound
  // guards against a hypothetical cycle corrupting the pipeline.
  for (let hop = 0; hop < 10; hop += 1) {
    const [row] = await db
      .select({
        status: canonicalEntities.status,
        merged_into_id: canonicalEntities.merged_into_id,
      })
      .from(canonicalEntities)
      .where(
        and(
          eq(canonicalEntities.id, currentId),
          eq(canonicalEntities.tenant_id, tenantId),
        ),
      )
      .limit(1);
    if (!row || row.status !== "merged" || !row.merged_into_id) {
      return currentId;
    }
    currentId = row.merged_into_id;
  }
  return currentId;
}

async function findExactMappingTarget(
  db: IdentityDbClient,
  tenantId: string,
  sourceKeys: MatchSourceKey[],
): Promise<string | null> {
  if (sourceKeys.length === 0) return null;
  const predicates = sourceKeys.map((key) =>
    and(
      eq(entitySourceMappings.source_system, key.sourceSystem),
      eq(entitySourceMappings.namespace, key.namespace ?? ""),
      eq(entitySourceMappings.external_id, key.externalId),
    ),
  );
  const rows = await db
    .select({ canonical_entity_id: entitySourceMappings.canonical_entity_id })
    .from(entitySourceMappings)
    .where(
      and(eq(entitySourceMappings.tenant_id, tenantId), or(...predicates)),
    );
  if (rows.length === 0) return null;
  return resolveMergedRedirect(db, tenantId, rows[0]!.canonical_entity_id);
}

async function findClaimMatches(
  db: IdentityDbClient,
  tenantId: string,
  keys: Array<{ keyKind: string; valueHash: string }>,
): Promise<ClaimMatch[]> {
  if (keys.length === 0) return [];
  const hashes = keys.map((key) => key.valueHash);
  const rows = await db
    .select({
      key_kind: entityIdentityClaims.key_kind,
      value_hash: entityIdentityClaims.value_hash,
      canonical_entity_id: entityIdentityClaims.canonical_entity_id,
      display_name: canonicalEntities.display_name,
      canonical_status: canonicalEntities.status,
      merged_into_id: canonicalEntities.merged_into_id,
    })
    .from(entityIdentityClaims)
    .innerJoin(
      canonicalEntities,
      eq(entityIdentityClaims.canonical_entity_id, canonicalEntities.id),
    )
    .where(
      and(
        eq(entityIdentityClaims.tenant_id, tenantId),
        eq(entityIdentityClaims.state, "active"),
        eq(entityIdentityClaims.visibility, "tenant"),
        inArray(entityIdentityClaims.value_hash, hashes),
        sql`${canonicalEntities.status} != 'archived'`,
      ),
    );
  const wanted = new Set(keys.map((key) => `${key.keyKind}:${key.valueHash}`));
  const matches: ClaimMatch[] = [];
  for (const row of rows) {
    if (!wanted.has(`${row.key_kind}:${row.value_hash}`)) continue;
    const canonicalEntityId =
      row.canonical_status === "merged" && row.merged_into_id
        ? await resolveMergedRedirect(db, tenantId, row.canonical_entity_id)
        : row.canonical_entity_id;
    matches.push({
      keyKind: row.key_kind,
      canonicalEntityId,
      canonicalDisplayName: row.display_name,
    });
  }
  return matches;
}

async function findNameCandidates(
  db: IdentityDbClient,
  tenantId: string,
  entityTypeSlug: string,
  normalizedName: string,
): Promise<NameCandidate[]> {
  if (!normalizedName) return [];
  const rows = await db
    .select({
      id: canonicalEntities.id,
      display_name: canonicalEntities.display_name,
    })
    .from(canonicalEntities)
    .where(
      and(
        eq(canonicalEntities.tenant_id, tenantId),
        eq(canonicalEntities.entity_type_slug, entityTypeSlug),
        eq(canonicalEntities.normalized_name, normalizedName),
        eq(canonicalEntities.status, "active"),
      ),
    );
  return rows.map((row) => ({
    canonicalEntityId: row.id,
    displayName: row.display_name,
  }));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Normalized natural keys derived from a match request against the rules. */
export function normalizeNaturalKeys(
  request: Pick<MatchRequest, "displayName" | "naturalKeys">,
  rules: IdentityRule[],
): Array<{ keyKind: string; normalizedValue: string; valueHash: string }> {
  const ruleByKeyKind = new Map(rules.map((rule) => [rule.keyKind, rule]));
  const keys = new Map<string, { keyKind: string; normalizedValue: string }>();
  for (const naturalKey of request.naturalKeys ?? []) {
    const rule = ruleByKeyKind.get(naturalKey.keyKind);
    const normalizedValue = applyNormalization(
      rule?.normalization ?? "exact",
      naturalKey.rawValue,
    );
    if (!normalizedValue) continue;
    keys.set(`${naturalKey.keyKind}:${normalizedValue}`, {
      keyKind: naturalKey.keyKind,
      normalizedValue,
    });
  }
  return [...keys.values()].map((key) => ({
    ...key,
    valueHash: hashIdentityValue(key.normalizedValue),
  }));
}

export async function matchCanonicalEntity(
  db: IdentityDbClient,
  request: MatchRequest,
  rules: IdentityRule[],
): Promise<MatchVerdict> {
  const exactCanonicalEntityId = await findExactMappingTarget(
    db,
    request.tenantId,
    request.sourceKeys ?? [],
  );
  if (exactCanonicalEntityId) {
    return { kind: "exact", canonicalEntityId: exactCanonicalEntityId };
  }
  if (request.visibility === "private") {
    return { kind: "private_unmapped" };
  }

  const normalizedKeys = normalizeNaturalKeys(request, rules);
  const claimMatches = await findClaimMatches(
    db,
    request.tenantId,
    normalizedKeys.map((key) => ({
      keyKind: key.keyKind,
      valueHash: key.valueHash,
    })),
  );
  // Registry normalized_name doubles as the identity claim for keyKind
  // 'name': fold same-type same-name registry hits into the claim-match set
  // so a unique+autoLink 'name' rule treats an exact-name single match as a
  // strong key (deterministic re-resolution of already-registered entities),
  // while multi-matches stay ambiguous.
  const nameCandidates = await findNameCandidates(
    db,
    request.tenantId,
    request.entityTypeSlug,
    applyNormalization("name", request.displayName),
  );
  const seenClaimTargets = new Set(
    claimMatches
      .filter((match) => match.keyKind === "name")
      .map((match) => match.canonicalEntityId),
  );
  for (const candidate of nameCandidates) {
    if (seenClaimTargets.has(candidate.canonicalEntityId)) continue;
    claimMatches.push({
      keyKind: "name",
      canonicalEntityId: candidate.canonicalEntityId,
      canonicalDisplayName: candidate.displayName,
    });
  }

  return decideMatch({
    visibility: request.visibility,
    rules,
    exactCanonicalEntityId: null,
    claimMatches,
    nameCandidates: [],
  });
}

/**
 * Default rule set used when an ontology entity type declares no identity
 * rules: exact normalized-name equality within (tenant, type) is treated as
 * a strong unique key. Single exact-name matches auto-link deterministically
 * (the graph pipeline's steady state), multi-matches defer to the queue.
 */
export function defaultIdentityRules(): IdentityRule[] {
  return [
    {
      slug: "default-name",
      keyKind: "name",
      normalization: "name",
      unique: true,
      uniquenessScope: "tenant",
      sourcePrecedence: [],
      autoLink: true,
      version: 0,
    },
  ];
}
