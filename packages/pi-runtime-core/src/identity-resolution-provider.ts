/**
 * IdentityResolutionProvider — the host-supplied seam for the entity-identity
 * crosswalk (THINK-321 U5).
 *
 * A narrow
 * request/response contract; the host supplies transport + identity. The
 * identity-resolution extension reaches the crosswalk ONLY through this
 * interface — it never builds an HTTP/GraphQL client of its own — so the
 * extension is identical on the cloud and desktop hosts.
 *
 * Identity discipline (KTD-1): tenant/user/thread identity is NOT part of
 * this contract. The host closes over a turn-bound credential when it
 * constructs the provider (snapshot-at-entry, never re-read from env
 * mid-turn), and the platform API resolves tenant, user, and thread
 * server-side from that credential. A prompt-injected turn therefore cannot
 * flip tenants — or ghost-confirm a mapping as another user — by parameter.
 *
 * Consent discipline (KTD-2): `confirmMapping` is a THIN passthrough. The
 * server refuses unless the echoed candidate id equals the selection the
 * user actually recorded at answer intake — consent is enforced
 * server-side, never in this contract. `declineCandidates` is the
 * reject-all path: it files a deduped resolution case instead of writing a
 * mapping.
 */

/** A reference to one entity, in any of the three ref shapes (KTD-1). */
export type IdentityResolutionEntityRef =
  | { canonicalId: string }
  | { sourceSystem: string; namespace?: string; externalId: string }
  | { name: string; entityTypeSlug: string };

/**
 * One crosswalk mapping with full provenance (KTD-1). `connectorSlug` is
 * null — and `fetchable` false — when the source system has no registered
 * connector link (fail-closed, KTD-5): the caller must never invent a slug.
 */
export interface IdentityResolutionMappingItem {
  sourceSystem: string;
  namespace: string;
  externalId: string;
  connectorSlug: string | null;
  fetchable: boolean;
  unroutableReason: string | null;
  createdBy: string;
  createdByUserId: string | null;
  createdThreadRef: string | null;
  createdAt: string | null;
  /** curated | matched | user_confirmed — who vouches for this link. */
  caveat: string;
  confidence: number | null;
}

export interface IdentityResolutionHit {
  canonicalEntityId: string;
  displayName: string;
  entityTypeSlug: string;
  mappings: IdentityResolutionMappingItem[];
}

export interface IdentityResolutionRefResult {
  status: "hit" | "miss";
  /** Miss reason (not_found | ambiguous_name | archived | invalid_ref). */
  unroutable: string | null;
  entity: IdentityResolutionHit | null;
}

export interface IdentityResolutionResolveRequest {
  refs: IdentityResolutionEntityRef[];
  /** Restrict returned mappings to these source systems. */
  targetSystems?: string[];
  /** Zero-based page over the refs array (server-capped page size). */
  page?: number;
}

export interface IdentityResolutionResolveResult {
  results: IdentityResolutionRefResult[];
  page: number;
  limit: number;
  totalRefs: number;
  hasMore: boolean;
}

/** A candidate source record for an unmapped entity (external data). */
export interface IdentityResolutionCandidate {
  id: string;
  sourceSystem: string;
  namespace: string;
  externalId: string;
  matchedKeyKinds: string[];
  /** keyKind → normalized value that matched (external record data). */
  normalizedValues: Record<string, string>;
  confidence: number | null;
}

export interface IdentityResolutionProposeRequest {
  canonicalEntityId: string;
  targetSystem: string;
}

export type IdentityResolutionProposeResult =
  | {
      status: "proposed";
      candidateSetId: string;
      candidates: IdentityResolutionCandidate[];
      expiresAt: string | null;
    }
  | { status: "refused"; reason: string };

export interface IdentityResolutionConfirmRequest {
  candidateSetId: string;
  candidateId: string;
}

export type IdentityResolutionConfirmResult =
  | {
      status: "confirmed";
      mappingId: string;
      canonicalEntityId: string;
      sourceSystem: string;
      namespace: string;
      externalId: string;
    }
  | {
      status: "already_linked";
      existingMappingId: string;
      existingCanonicalEntityId: string;
    }
  | { status: "refused"; reason: string };

export interface IdentityResolutionDeclineRequest {
  candidateSetId: string;
}

export type IdentityResolutionDeclineResult =
  | { status: "declined"; caseId: string; coalesced: boolean }
  | { status: "refused"; reason: string };

export interface IdentityResolutionProvider {
  /**
   * Bulk-first crosswalk resolve (R1/R2): per-ref hit/miss with full
   * mapping provenance. The optional `signal` lets the caller cancel an
   * in-flight call — the agent-facing tool passes the turn's abort signal.
   */
  resolveEntities(
    request: IdentityResolutionResolveRequest,
    signal?: AbortSignal,
  ): Promise<IdentityResolutionResolveResult>;

  /**
   * Rank candidate matches for one entity's unmapped target system from
   * identity claims already in the store (drift-bounded — no live fetch)
   * and persist the set server-side for the consent echo check (KTD-2).
   */
  proposeMappingCandidates(
    request: IdentityResolutionProposeRequest,
    signal?: AbortSignal,
  ): Promise<IdentityResolutionProposeResult>;

  /**
   * Thin consent passthrough: succeeds only when the echoed candidate id
   * equals the user selection recorded server-side at answer intake.
   */
  confirmMapping(
    request: IdentityResolutionConfirmRequest,
    signal?: AbortSignal,
  ): Promise<IdentityResolutionConfirmResult>;

  /**
   * Reject-all path (R16): no mapping is written; a signature-deduped
   * resolution case is filed with agent/turn provenance.
   */
  declineCandidates(
    request: IdentityResolutionDeclineRequest,
    signal?: AbortSignal,
  ): Promise<IdentityResolutionDeclineResult>;
}
