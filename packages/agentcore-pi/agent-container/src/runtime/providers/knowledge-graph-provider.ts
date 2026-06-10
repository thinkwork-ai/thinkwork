import type {
  KnowledgeGraphEntityItem,
  KnowledgeGraphProvider,
  KnowledgeGraphRelationshipItem,
  KnowledgeGraphSearchRequest,
  KnowledgeGraphSearchResult,
} from "@thinkwork/pi-runtime-core";

/**
 * Plan 2026-06-09-004 U8 — platform-API-backed {@link KnowledgeGraphProvider}.
 *
 * The cloud host constructs this per invocation with identity snapshotted at
 * loop entry (apiUrl/apiSecret/turn reference from the invocation payload —
 * never re-read from `process.env` mid-turn, see
 * feedback_completion_callback_snapshot_pattern), then hands it to the
 * knowledge-graph extension through the provider bundle. Only THIS module
 * knows the platform GraphQL shape, so the extension stays host-agnostic.
 *
 * Turn-bound auth (R15): the request carries the current `x-thread-turn-id`
 * (or `x-thread-id` when no turn row exists). The API's
 * `knowledgeGraphSearch` resolver derives the tenant SERVER-SIDE from that
 * reference and rejects mismatched assertions — this provider never sends an
 * `x-tenant-id` header, exactly so there is no caller-asserted tenant to
 * trust.
 *
 * Transport: a SINGLE attempt with a 10s timeout. This is an in-turn tool —
 * a degraded backend should surface as the extension's "unavailable" result
 * quickly, not stall the turn behind a retry ladder (contrast the hindsight
 * memory provider's bounded retry, which guards proactive grounding).
 */

const DEFAULT_TIMEOUT_MS = 10_000;

const SEARCH_QUERY = /* GraphQL */ `
  query KnowledgeGraphSearch($query: String!, $limit: Int) {
    knowledgeGraphSearch(query: $query, limit: $limit) {
      entities {
        id
        label
        typeSlug
        summary
        aliases
        relationshipCount
        evidenceCount
        observationIds
      }
      relationships {
        id
        label
        typeSlug
        fromLabel
        toLabel
      }
    }
  }
`;

export interface ApiKnowledgeGraphProviderOptions {
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

export class ApiKnowledgeGraphProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiKnowledgeGraphProviderError";
  }
}

function requireScope(options: ApiKnowledgeGraphProviderOptions): void {
  if (!options.apiUrl?.trim()) {
    throw new ApiKnowledgeGraphProviderError(
      "Knowledge graph provider constructed without an apiUrl.",
    );
  }
  if (!options.apiSecret?.trim()) {
    throw new ApiKnowledgeGraphProviderError(
      "Knowledge graph provider constructed without an apiSecret.",
    );
  }
  if (!options.threadTurnId?.trim() && !options.threadId?.trim()) {
    throw new ApiKnowledgeGraphProviderError(
      "Knowledge graph provider constructed without a turn-bound reference " +
        "(threadTurnId or threadId).",
    );
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toEntity(raw: unknown): KnowledgeGraphEntityItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.label !== "string") {
    return null;
  }
  return {
    id: record.id,
    label: record.label,
    typeSlug: typeof record.typeSlug === "string" ? record.typeSlug : null,
    summary: typeof record.summary === "string" ? record.summary : null,
    aliases: asStringArray(record.aliases),
    relationshipCount:
      typeof record.relationshipCount === "number"
        ? record.relationshipCount
        : 0,
    evidenceCount:
      typeof record.evidenceCount === "number" ? record.evidenceCount : 0,
    observationIds: asStringArray(record.observationIds),
  };
}

function toRelationship(raw: unknown): KnowledgeGraphRelationshipItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.label !== "string" ||
    typeof record.fromLabel !== "string" ||
    typeof record.toLabel !== "string"
  ) {
    return null;
  }
  return {
    id: record.id,
    label: record.label,
    typeSlug: typeof record.typeSlug === "string" ? record.typeSlug : null,
    fromLabel: record.fromLabel,
    toLabel: record.toLabel,
  };
}

/**
 * Build a platform-API-backed {@link KnowledgeGraphProvider}. Identity
 * (apiUrl/apiSecret/turn reference) is captured here at construction time and
 * never re-read from the environment mid-turn (cred-snapshot-at-entry).
 */
export function createApiKnowledgeGraphProvider(
  options: ApiKnowledgeGraphProviderOptions,
): KnowledgeGraphProvider {
  requireScope(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.apiUrl.replace(/\/+$/, "")}/graphql`;
  const turnHeaders: Record<string, string> = options.threadTurnId?.trim()
    ? { "x-thread-turn-id": options.threadTurnId.trim() }
    : { "x-thread-id": options.threadId!.trim() };

  return {
    async search(
      request: KnowledgeGraphSearchRequest,
      signal?: AbortSignal,
    ): Promise<KnowledgeGraphSearchResult> {
      const query = request.query?.trim();
      if (!query) {
        throw new ApiKnowledgeGraphProviderError(
          "search called with an empty query.",
        );
      }

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
          body: JSON.stringify({
            query: SEARCH_QUERY,
            variables: { query, limit: request.limit ?? null },
          }),
          signal: attemptSignal,
        });
      } catch (err) {
        throw new ApiKnowledgeGraphProviderError(
          `Knowledge graph transport error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      const text = await response.text();
      if (!response.ok) {
        throw new ApiKnowledgeGraphProviderError(
          `Knowledge graph API ${response.status}: ${text.slice(0, 400)}`,
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        throw new ApiKnowledgeGraphProviderError(
          "Knowledge graph API returned a non-JSON response.",
        );
      }
      const record = (payload ?? {}) as Record<string, unknown>;
      if (Array.isArray(record.errors) && record.errors.length > 0) {
        const first = record.errors[0] as Record<string, unknown> | undefined;
        const message =
          typeof first?.message === "string" ? first.message : "unknown error";
        throw new ApiKnowledgeGraphProviderError(
          `Knowledge graph query failed: ${message}`,
        );
      }
      const data = (record.data ?? {}) as Record<string, unknown>;
      const result = (data.knowledgeGraphSearch ?? {}) as Record<
        string,
        unknown
      >;
      return {
        entities: (Array.isArray(result.entities) ? result.entities : [])
          .map(toEntity)
          .filter((item): item is KnowledgeGraphEntityItem => item !== null),
        relationships: (Array.isArray(result.relationships)
          ? result.relationships
          : []
        )
          .map(toRelationship)
          .filter(
            (item): item is KnowledgeGraphRelationshipItem => item !== null,
          ),
      };
    },
  };
}
