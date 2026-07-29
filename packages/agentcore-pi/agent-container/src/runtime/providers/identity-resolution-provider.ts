import type {
  IdentityResolutionCandidate,
  IdentityResolutionConfirmRequest,
  IdentityResolutionConfirmResult,
  IdentityResolutionDeclineRequest,
  IdentityResolutionDeclineResult,
  IdentityResolutionEntityRef,
  IdentityResolutionHit,
  IdentityResolutionMappingItem,
  IdentityResolutionProposeRequest,
  IdentityResolutionProposeResult,
  IdentityResolutionProvider,
  IdentityResolutionRefResult,
  IdentityResolutionResolveRequest,
  IdentityResolutionResolveResult,
} from "@thinkwork/pi-runtime-core";

/**
 * THINK-321 U5 — platform-API-backed {@link IdentityResolutionProvider}.
 *
 * The cloud host constructs this per invocation with identity snapshotted at
 * loop entry (apiUrl/apiSecret/turn reference from the invocation payload —
 * never re-read from `process.env` mid-turn), then hands it to the
 * identity-resolution extension through the provider bundle. Only THIS
 * module knows the platform GraphQL shape, so the extension stays
 * host-agnostic.
 *
 * Turn-bound auth (KTD-1): the request carries the current
 * `x-thread-turn-id` (or `x-thread-id` when no turn row exists). The API's
 * entity-identity resolvers derive tenant, user, and thread SERVER-SIDE from
 * that reference and reject mismatched assertions — this provider never
 * sends an `x-tenant-id` header, exactly so there is no caller-asserted
 * tenant to trust, and the model's confirm can only be attributed to the
 * turn's real user.
 *
 * Transport: a SINGLE attempt with a 10s timeout. This is an in-turn tool —
 * a degraded backend should surface as the extension's "unavailable" result
 * quickly, not stall the turn behind a retry ladder.
 *
 * `declineCandidates` rides along even though no tool maps to it directly in
 * U5 — the U6 miss-path flow needs the reject-all passthrough.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

const MAPPING_FIELDS = /* GraphQL */ `
  sourceSystem
  namespace
  externalId
  connectorSlug
  fetchable
  unroutableReason
  createdBy
  createdByUserId
  createdThreadRef
  createdAt
  caveat
  confidence
`;

const RESOLVE_QUERY = /* GraphQL */ `
  query ResolveEntities(
    $refs: [EntityRefInput!]!
    $targetSystems: [String!]
    $page: Int
    $limit: Int
  ) {
    resolveEntities(
      refs: $refs
      targetSystems: $targetSystems
      page: $page
      limit: $limit
    ) {
      results {
        status
        unroutable
        entity {
          canonicalEntityId
          displayName
          entityTypeSlug
          mappings {
            ${MAPPING_FIELDS}
          }
        }
      }
      page
      limit
      totalRefs
      hasMore
    }
  }
`;

const PROPOSE_MUTATION = /* GraphQL */ `
  mutation ProposeMappingCandidates(
    $canonicalEntityId: ID!
    $targetSystem: String!
  ) {
    proposeMappingCandidates(
      canonicalEntityId: $canonicalEntityId
      targetSystem: $targetSystem
    ) {
      status
      reason
      candidateSetId
      candidates
      expiresAt
    }
  }
`;

const CONFIRM_MUTATION = /* GraphQL */ `
  mutation ConfirmEntityMapping($candidateSetId: ID!, $candidateId: String!) {
    confirmEntityMapping(
      candidateSetId: $candidateSetId
      candidateId: $candidateId
    ) {
      status
      reason
      mappingId
      canonicalEntityId
      sourceSystem
      namespace
      externalId
      existingMappingId
      existingCanonicalEntityId
    }
  }
`;

const DECLINE_MUTATION = /* GraphQL */ `
  mutation DeclineEntityMappingCandidates($candidateSetId: ID!) {
    declineEntityMappingCandidates(candidateSetId: $candidateSetId) {
      status
      reason
      caseId
      coalesced
    }
  }
`;

export interface ApiIdentityResolutionProviderOptions {
  /** Platform API base URL (payload.thinkwork_api_url). Required. */
  apiUrl: string;
  /** Service bearer secret (payload.thinkwork_api_secret). Required. */
  apiSecret: string;
  /**
   * The current turn's `thread_turns.id` (payload.thread_turn_id). The
   * strongest turn-bound reference — the API only honors it while the turn
   * is live. One of threadTurnId / threadId is required.
   */
  threadTurnId?: string;
  /** Fallback turn-bound reference: the current thread id. */
  threadId?: string;
  /** Request timeout in ms (default 10_000). Single attempt, no retry. */
  timeoutMs?: number;
  /** Test seam: override the global fetch implementation. */
  fetchImpl?: typeof fetch;
}

export class ApiIdentityResolutionProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiIdentityResolutionProviderError";
  }
}

function requireScope(options: ApiIdentityResolutionProviderOptions): void {
  if (!options.apiUrl?.trim()) {
    throw new ApiIdentityResolutionProviderError(
      "Identity resolution provider constructed without an apiUrl.",
    );
  }
  if (!options.apiSecret?.trim()) {
    throw new ApiIdentityResolutionProviderError(
      "Identity resolution provider constructed without an apiSecret.",
    );
  }
  if (!options.threadTurnId?.trim() && !options.threadId?.trim()) {
    throw new ApiIdentityResolutionProviderError(
      "Identity resolution provider constructed without a turn-bound " +
        "reference (threadTurnId or threadId).",
    );
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toMapping(raw: unknown): IdentityResolutionMappingItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const sourceSystem = asString(record.sourceSystem);
  const externalId = asString(record.externalId);
  if (sourceSystem == null || externalId == null) return null;
  return {
    sourceSystem,
    namespace: asString(record.namespace) ?? "",
    externalId,
    connectorSlug: asString(record.connectorSlug),
    fetchable: record.fetchable === true,
    unroutableReason: asString(record.unroutableReason),
    createdBy: asString(record.createdBy) ?? "unknown",
    createdByUserId: asString(record.createdByUserId),
    createdThreadRef: asString(record.createdThreadRef),
    createdAt: asString(record.createdAt),
    caveat: asString(record.caveat) ?? "matched",
    confidence: asNumber(record.confidence),
  };
}

function toHit(raw: unknown): IdentityResolutionHit | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const canonicalEntityId = asString(record.canonicalEntityId);
  if (canonicalEntityId == null) return null;
  return {
    canonicalEntityId,
    displayName: asString(record.displayName) ?? "",
    entityTypeSlug: asString(record.entityTypeSlug) ?? "",
    mappings: (Array.isArray(record.mappings) ? record.mappings : [])
      .map(toMapping)
      .filter((item): item is IdentityResolutionMappingItem => item !== null),
  };
}

function toRefResult(raw: unknown): IdentityResolutionRefResult {
  const record = (raw ?? {}) as Record<string, unknown>;
  const entity = toHit(record.entity);
  const status = record.status === "hit" && entity ? "hit" : "miss";
  return {
    status,
    unroutable:
      status === "miss" ? (asString(record.unroutable) ?? "not_found") : null,
    entity: status === "hit" ? entity : null,
  };
}

function toCandidate(raw: unknown): IdentityResolutionCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = asString(record.id);
  const sourceSystem = asString(record.sourceSystem);
  const externalId = asString(record.externalId);
  if (id == null || sourceSystem == null || externalId == null) return null;
  const normalizedValues: Record<string, string> = {};
  if (record.normalizedValues && typeof record.normalizedValues === "object") {
    for (const [key, value] of Object.entries(
      record.normalizedValues as Record<string, unknown>,
    )) {
      if (typeof value === "string") normalizedValues[key] = value;
    }
  }
  return {
    id,
    sourceSystem,
    namespace: asString(record.namespace) ?? "",
    externalId,
    matchedKeyKinds: asStringArray(record.matchedKeyKinds),
    normalizedValues,
    confidence: asNumber(record.confidence),
  };
}

function parseCandidates(value: unknown): IdentityResolutionCandidate[] {
  // AWSJSON rides the wire as either a JSON string or a decoded array
  // depending on the transport — accept both (THINK-188 dual wire shape).
  let decoded: unknown = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value);
    } catch {
      decoded = [];
    }
  }
  return (Array.isArray(decoded) ? decoded : [])
    .map(toCandidate)
    .filter((item): item is IdentityResolutionCandidate => item !== null);
}

/**
 * Build a platform-API-backed {@link IdentityResolutionProvider}. Identity
 * (apiUrl/apiSecret/turn reference) is captured here at construction time
 * and never re-read from the environment mid-turn (cred-snapshot-at-entry).
 */
export function createApiIdentityResolutionProvider(
  options: ApiIdentityResolutionProviderOptions,
): IdentityResolutionProvider {
  requireScope(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.apiUrl.replace(/\/+$/, "")}/graphql`;
  const turnHeaders: Record<string, string> = options.threadTurnId?.trim()
    ? { "x-thread-turn-id": options.threadTurnId.trim() }
    : { "x-thread-id": options.threadId!.trim() };

  async function executeGraphQuery(
    queryDoc: string,
    variables: Record<string, unknown>,
    resultField: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    // Compose the caller's signal with the request timeout so the caller's
    // cancellation still wins, but a hung backend aborts after timeoutMs.
    // Single attempt — in-turn tool latency beats retry completeness.
    const attemptSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiSecret}`,
          ...turnHeaders,
        },
        body: JSON.stringify({ query: queryDoc, variables }),
        signal: attemptSignal,
      });
    } catch (err) {
      throw new ApiIdentityResolutionProviderError(
        `Identity resolution transport error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw new ApiIdentityResolutionProviderError(
        `Identity resolution API ${response.status}: ${text.slice(0, 400)}`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiIdentityResolutionProviderError(
        "Identity resolution API returned a non-JSON response.",
      );
    }
    const record = (payload ?? {}) as Record<string, unknown>;
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      const first = record.errors[0] as Record<string, unknown> | undefined;
      const message =
        typeof first?.message === "string" ? first.message : "unknown error";
      throw new ApiIdentityResolutionProviderError(
        `Identity resolution query failed: ${message}`,
      );
    }
    const data = (record.data ?? {}) as Record<string, unknown>;
    return (data[resultField] ?? {}) as Record<string, unknown>;
  }

  function toWireRef(
    ref: IdentityResolutionEntityRef,
  ): Record<string, unknown> {
    if ("canonicalId" in ref && typeof ref.canonicalId === "string") {
      return { canonicalId: ref.canonicalId };
    }
    if (
      "sourceSystem" in ref &&
      typeof ref.sourceSystem === "string" &&
      typeof ref.externalId === "string"
    ) {
      return {
        sourceSystem: ref.sourceSystem,
        namespace: ref.namespace ?? null,
        externalId: ref.externalId,
      };
    }
    if ("name" in ref && typeof ref.name === "string") {
      return { name: ref.name, entityTypeSlug: ref.entityTypeSlug };
    }
    // Malformed ref: send an empty shape so the server reports an explicit
    // invalid_ref miss for it rather than dropping the entry.
    return {};
  }

  return {
    async resolveEntities(
      request: IdentityResolutionResolveRequest,
      signal?: AbortSignal,
    ): Promise<IdentityResolutionResolveResult> {
      if (!Array.isArray(request.refs) || request.refs.length === 0) {
        throw new ApiIdentityResolutionProviderError(
          "resolveEntities called with no refs.",
        );
      }
      const result = await executeGraphQuery(
        RESOLVE_QUERY,
        {
          refs: request.refs.map(toWireRef),
          targetSystems: request.targetSystems ?? null,
          page: request.page ?? null,
          limit: null,
        },
        "resolveEntities",
        signal,
      );
      return {
        results: (Array.isArray(result.results) ? result.results : []).map(
          toRefResult,
        ),
        page: asNumber(result.page) ?? 0,
        limit: asNumber(result.limit) ?? 0,
        totalRefs: asNumber(result.totalRefs) ?? 0,
        hasMore: result.hasMore === true,
      };
    },

    async proposeMappingCandidates(
      request: IdentityResolutionProposeRequest,
      signal?: AbortSignal,
    ): Promise<IdentityResolutionProposeResult> {
      const canonicalEntityId = request.canonicalEntityId?.trim();
      const targetSystem = request.targetSystem?.trim();
      if (!canonicalEntityId || !targetSystem) {
        throw new ApiIdentityResolutionProviderError(
          "proposeMappingCandidates called without a canonicalEntityId or targetSystem.",
        );
      }
      const result = await executeGraphQuery(
        PROPOSE_MUTATION,
        { canonicalEntityId, targetSystem },
        "proposeMappingCandidates",
        signal,
      );
      if (result.status !== "proposed") {
        return {
          status: "refused",
          reason: asString(result.reason) ?? "unknown",
        };
      }
      return {
        status: "proposed",
        candidateSetId: asString(result.candidateSetId) ?? "",
        candidates: parseCandidates(result.candidates),
        expiresAt: asString(result.expiresAt),
      };
    },

    async confirmMapping(
      request: IdentityResolutionConfirmRequest,
      signal?: AbortSignal,
    ): Promise<IdentityResolutionConfirmResult> {
      const candidateSetId = request.candidateSetId?.trim();
      const candidateId = request.candidateId?.trim();
      if (!candidateSetId || !candidateId) {
        throw new ApiIdentityResolutionProviderError(
          "confirmMapping called without a candidateSetId or candidateId.",
        );
      }
      const result = await executeGraphQuery(
        CONFIRM_MUTATION,
        { candidateSetId, candidateId },
        "confirmEntityMapping",
        signal,
      );
      if (result.status === "confirmed") {
        return {
          status: "confirmed",
          mappingId: asString(result.mappingId) ?? "",
          canonicalEntityId: asString(result.canonicalEntityId) ?? "",
          sourceSystem: asString(result.sourceSystem) ?? "",
          namespace: asString(result.namespace) ?? "",
          externalId: asString(result.externalId) ?? "",
        };
      }
      if (result.status === "already_linked") {
        return {
          status: "already_linked",
          existingMappingId: asString(result.existingMappingId) ?? "",
          existingCanonicalEntityId:
            asString(result.existingCanonicalEntityId) ?? "",
        };
      }
      return {
        status: "refused",
        reason: asString(result.reason) ?? "unknown",
      };
    },

    async declineCandidates(
      request: IdentityResolutionDeclineRequest,
      signal?: AbortSignal,
    ): Promise<IdentityResolutionDeclineResult> {
      const candidateSetId = request.candidateSetId?.trim();
      if (!candidateSetId) {
        throw new ApiIdentityResolutionProviderError(
          "declineCandidates called without a candidateSetId.",
        );
      }
      const result = await executeGraphQuery(
        DECLINE_MUTATION,
        { candidateSetId },
        "declineEntityMappingCandidates",
        signal,
      );
      if (result.status !== "declined") {
        return {
          status: "refused",
          reason: asString(result.reason) ?? "unknown",
        };
      }
      return {
        status: "declined",
        caseId: asString(result.caseId) ?? "",
        coalesced: result.coalesced === true,
      };
    },
  };
}
