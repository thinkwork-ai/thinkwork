/**
 * THINK-193 U8 — external-memory golden set.
 *
 * A deterministic quality evaluation over the DB + Hindsight for one named
 * canonical entity (default "Acme"), scoring the plan's five quality axes
 * rather than item throughput:
 *
 *   1. entity_precision        — exactly ONE active canonical entity per
 *                                golden identity (across name variants);
 *   2. duplicate_page_rate     — zero active tenant Entity pages sharing a
 *                                canonical id, and zero same-name active
 *                                entity pages without a canonical id;
 *   3. claim_faithfulness      — active claims match fixture expectations,
 *                                including temporal closure (every
 *                                non-active claim has effective_to set);
 *   4. provenance_completeness — every active golden claim has at least one
 *                                ACTIVE evidence support edge, and the
 *                                canonical page's sections carry sources;
 *   5. retraction_correctness  — retracted golden values are absent from
 *                                recall results.
 *
 * Shaped as PURE functions over an already-collected snapshot: the checks
 * never do I/O, so unit tests inject fixture data and the runnable wrapper
 * (packages/api/scripts/run-external-memory-golden-set.ts) collects the
 * snapshot from the deployed dev DB + Hindsight with injected readers.
 */

// ---------------------------------------------------------------------------
// Snapshot + expectation types
// ---------------------------------------------------------------------------

export interface GoldenCanonicalEntity {
  id: string;
  displayName: string;
  normalizedName: string;
  status: string; // 'active' | 'merged' | 'archived'
}

export interface GoldenEntityPage {
  id: string;
  canonicalEntityId: string | null;
  title: string;
  status: string; // 'active' | 'archived'
  /** Section source refs attached to this page (wiki.section_sources). */
  sectionSourceRefs: string[];
}

export interface GoldenClaim {
  id: string;
  subjectKey: string;
  ontologyPredicate: string;
  valueHash: string;
  status: string; // 'active' | 'superseded' | 'retracted'
  effectiveTo: Date | null;
  /** Count of ACTIVE memory_claim_evidence edges for this claim. */
  activeEvidenceEdges: number;
}

export interface GoldenRecallHit {
  /** Flattened recall text (or document content) for containment checks. */
  text: string;
}

/** Everything the checks need, collected up front. */
export interface GoldenSetSnapshot {
  /** Active canonical entities whose normalized name matches ANY golden
   * name variant. */
  canonicalEntities: GoldenCanonicalEntity[];
  /** Active tenant-scope Entity pages matching the golden identity (by
   * canonical id or by title variant). */
  entityPages: GoldenEntityPage[];
  /** ALL claims (any status) for the golden subject keys. */
  claims: GoldenClaim[];
  /** Recall results for the golden query. Null = recall unavailable
   * (retraction_correctness reports skipped instead of pass/fail). */
  recallHits: GoldenRecallHit[] | null;
}

export interface GoldenClaimExpectation {
  ontologyPredicate: string;
  /** Expected value hash of the ACTIVE claim; omit to only require that an
   * active claim exists for the predicate. */
  valueHash?: string;
}

export interface GoldenSetExpectations {
  /** Golden display name, e.g. "Acme". */
  entityName: string;
  /** Normalized name variants that must resolve to ONE canonical entity
   * (e.g. from Twenty, Firecrawl, Gmail, and a policy document). */
  nameVariants: string[];
  /** Predicates that must have exactly one ACTIVE claim. */
  activeClaims: GoldenClaimExpectation[];
  /** Value fragments that were retracted and must NOT appear in recall. */
  retractedValueFragments: string[];
}

/** Default cross-source Acme golden identity (plan §U8). */
export const DEFAULT_GOLDEN_EXPECTATIONS: GoldenSetExpectations = {
  entityName: "Acme",
  nameVariants: ["acme", "acme corp", "acme inc", "acme corporation"],
  activeClaims: [{ ontologyPredicate: "customer.name" }],
  retractedValueFragments: [],
};

// ---------------------------------------------------------------------------
// Check results
// ---------------------------------------------------------------------------

export type GoldenCheckStatus = "pass" | "fail" | "skipped";

export interface GoldenCheckResult {
  check:
    | "entity_precision"
    | "duplicate_page_rate"
    | "claim_faithfulness"
    | "provenance_completeness"
    | "retraction_correctness";
  status: GoldenCheckStatus;
  details: string[];
}

export interface GoldenSetResult {
  entityName: string;
  pass: boolean;
  checks: GoldenCheckResult[];
}

// ---------------------------------------------------------------------------
// Pure checks
// ---------------------------------------------------------------------------

export function checkEntityPrecision(
  snapshot: GoldenSetSnapshot,
  expectations: GoldenSetExpectations,
): GoldenCheckResult {
  const active = snapshot.canonicalEntities.filter(
    (e) => e.status === "active",
  );
  const details: string[] = [];
  if (active.length === 0) {
    details.push(
      `no active canonical entity matches ${JSON.stringify(expectations.nameVariants)}`,
    );
  } else if (active.length > 1) {
    details.push(
      `${active.length} active canonical entities match one golden identity: ${active
        .map((e) => `${e.displayName} (${e.id})`)
        .join(", ")}`,
    );
  }
  return {
    check: "entity_precision",
    status: details.length === 0 ? "pass" : "fail",
    details,
  };
}

export function checkDuplicatePageRate(
  snapshot: GoldenSetSnapshot,
): GoldenCheckResult {
  const details: string[] = [];
  const activePages = snapshot.entityPages.filter((p) => p.status === "active");
  const byCanonical = new Map<string, number>();
  for (const page of activePages) {
    if (!page.canonicalEntityId) continue;
    byCanonical.set(
      page.canonicalEntityId,
      (byCanonical.get(page.canonicalEntityId) ?? 0) + 1,
    );
  }
  for (const [canonicalId, count] of byCanonical) {
    if (count > 1) {
      details.push(`canonical ${canonicalId} has ${count} active pages`);
    }
  }
  const withoutCanonical = activePages.filter((p) => !p.canonicalEntityId);
  if (withoutCanonical.length > 0 && byCanonical.size > 0) {
    // Same golden identity rendered as both a canonical page and a
    // canonical-less page — the duplicate the plan's alarm watches for.
    details.push(
      `${withoutCanonical.length} same-name active entity page(s) without a canonical id: ${withoutCanonical
        .map((p) => p.title)
        .join(", ")}`,
    );
  }
  return {
    check: "duplicate_page_rate",
    status: details.length === 0 ? "pass" : "fail",
    details,
  };
}

export function checkClaimFaithfulness(
  snapshot: GoldenSetSnapshot,
  expectations: GoldenSetExpectations,
): GoldenCheckResult {
  const details: string[] = [];
  for (const expected of expectations.activeClaims) {
    const active = snapshot.claims.filter(
      (c) =>
        c.ontologyPredicate === expected.ontologyPredicate &&
        c.status === "active",
    );
    if (active.length !== 1) {
      details.push(
        `${expected.ontologyPredicate}: expected exactly 1 active claim, found ${active.length}`,
      );
      continue;
    }
    if (expected.valueHash && active[0]!.valueHash !== expected.valueHash) {
      details.push(
        `${expected.ontologyPredicate}: active value hash ${active[0]!.valueHash.slice(0, 12)}… != expected ${expected.valueHash.slice(0, 12)}…`,
      );
    }
  }
  // Temporal closure: every ended interval is closed.
  for (const claim of snapshot.claims) {
    if (claim.status !== "active" && claim.effectiveTo === null) {
      details.push(
        `${claim.ontologyPredicate} claim ${claim.id} is ${claim.status} with an OPEN interval (effective_to null)`,
      );
    }
  }
  return {
    check: "claim_faithfulness",
    status: details.length === 0 ? "pass" : "fail",
    details,
  };
}

export function checkProvenanceCompleteness(
  snapshot: GoldenSetSnapshot,
): GoldenCheckResult {
  const details: string[] = [];
  for (const claim of snapshot.claims) {
    if (claim.status === "active" && claim.activeEvidenceEdges === 0) {
      details.push(
        `active claim ${claim.id} (${claim.ontologyPredicate}) has zero active evidence edges`,
      );
    }
  }
  const activeCanonicalPages = snapshot.entityPages.filter(
    (p) => p.status === "active" && p.canonicalEntityId,
  );
  for (const page of activeCanonicalPages) {
    if (page.sectionSourceRefs.length === 0) {
      details.push(
        `canonical page "${page.title}" (${page.id}) has zero section sources`,
      );
    }
  }
  return {
    check: "provenance_completeness",
    status: details.length === 0 ? "pass" : "fail",
    details,
  };
}

export function checkRetractionCorrectness(
  snapshot: GoldenSetSnapshot,
  expectations: GoldenSetExpectations,
): GoldenCheckResult {
  if (snapshot.recallHits === null) {
    return {
      check: "retraction_correctness",
      status:
        expectations.retractedValueFragments.length === 0 ? "pass" : "skipped",
      details:
        expectations.retractedValueFragments.length === 0
          ? []
          : ["recall unavailable — run against the deployed stack"],
    };
  }
  const details: string[] = [];
  const haystack = snapshot.recallHits
    .map((hit) => hit.text.toLowerCase())
    .join("\n");
  for (const fragment of expectations.retractedValueFragments) {
    if (haystack.includes(fragment.toLowerCase())) {
      details.push(`retracted value "${fragment}" still present in recall`);
    }
  }
  return {
    check: "retraction_correctness",
    status: details.length === 0 ? "pass" : "fail",
    details,
  };
}

/** Run all five checks over one collected snapshot. */
export function evaluateGoldenSet(
  snapshot: GoldenSetSnapshot,
  expectations: GoldenSetExpectations = DEFAULT_GOLDEN_EXPECTATIONS,
): GoldenSetResult {
  const checks: GoldenCheckResult[] = [
    checkEntityPrecision(snapshot, expectations),
    checkDuplicatePageRate(snapshot),
    checkClaimFaithfulness(snapshot, expectations),
    checkProvenanceCompleteness(snapshot),
    checkRetractionCorrectness(snapshot, expectations),
  ];
  return {
    entityName: expectations.entityName,
    pass: checks.every((c) => c.status !== "fail"),
    checks,
  };
}

// ---------------------------------------------------------------------------
// Snapshot collection over injected readers (I/O boundary)
// ---------------------------------------------------------------------------

export interface GoldenSetReaders {
  /** Active-or-not canonical entities whose normalized_name is one of the
   * variants (tenant-scoped). */
  findCanonicalEntities(
    nameVariants: string[],
  ): Promise<GoldenCanonicalEntity[]>;
  /** Tenant-scope Entity pages for those canonical ids OR title variants,
   * each carrying its section source refs. */
  listEntityPages(
    canonicalEntityIds: string[],
    nameVariants: string[],
  ): Promise<GoldenEntityPage[]>;
  /** ALL claims (any status) whose canonical subject resolves to one of
   * the canonical ids — or whose subject_key is in the fixture set. */
  listClaims(canonicalEntityIds: string[]): Promise<GoldenClaim[]>;
  /** Recall over the shared bank for the golden query; null = unavailable. */
  recall(query: string): Promise<GoldenRecallHit[] | null>;
}

export async function collectGoldenSetSnapshot(
  readers: GoldenSetReaders,
  expectations: GoldenSetExpectations = DEFAULT_GOLDEN_EXPECTATIONS,
): Promise<GoldenSetSnapshot> {
  const canonicalEntities = await readers.findCanonicalEntities(
    expectations.nameVariants,
  );
  const canonicalIds = canonicalEntities
    .filter((e) => e.status === "active")
    .map((e) => e.id);
  const [entityPages, claims, recallHits] = await Promise.all([
    readers.listEntityPages(canonicalIds, expectations.nameVariants),
    readers.listClaims(canonicalIds),
    readers.recall(expectations.entityName),
  ]);
  return { canonicalEntities, entityPages, claims, recallHits };
}
