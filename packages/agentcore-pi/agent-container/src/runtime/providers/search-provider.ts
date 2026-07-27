import type {
  SearchLegResult,
  SearchProvider,
  SearchProviderRequest,
  SearchProviderResult,
} from "@thinkwork/pi-runtime-core";

/**
 * THINK-263 U8 — platform-API-backed {@link SearchProvider}.
 *
 * The cloud host constructs this per invocation with identity snapshotted at
 * loop entry (apiUrl/apiSecret/turn reference from the invocation payload —
 * never re-read from `process.env` mid-turn, see
 * feedback_completion_callback_snapshot_pattern), then hands it to the search
 * extension through the provider bundle. Only THIS module knows the platform
 * GraphQL shape, so the extension stays host-agnostic.
 *
 * Turn-bound auth: the request carries the current `x-thread-turn-id` (or
 * `x-thread-id` when no turn row exists). The API's `search` resolver derives
 * BOTH the tenant and the invoking user server-side from that reference and
 * runs the broker with that user's scope — this provider never sends an
 * `x-tenant-id` header, so there is no caller-asserted scope to trust.
 *
 * Transport: a SINGLE attempt with a 12s timeout (the broker's memory leg can
 * take longer than the KG one). A degraded backend surfaces as the
 * extension's "unavailable" result rather than stalling the turn.
 */

const DEFAULT_TIMEOUT_MS = 12_000;

const SEARCH_QUERY = /* GraphQL */ `
  query AgentSearch(
    $tenantId: ID!
    $query: String!
    $sources: [SearchSource!]
    $limit: Int
  ) {
    search(
      tenantId: $tenantId
      query: $query
      sources: $sources
      limit: $limit
    ) {
      queryId
      legs {
        source
        status
        threadHits {
          title
          identifier
        }
        entityHits {
          label
          ontologyTypeSlug
          summary
        }
        memoryHits {
          text
          threadId
        }
      }
    }
  }
`;

export interface ApiSearchProviderOptions {
  /** Platform API base URL (payload.thinkwork_api_url). Required. */
  apiUrl: string;
  /** Service bearer secret (payload.thinkwork_api_secret). Required. */
  apiSecret: string;
  /**
   * Tenant id from the invocation identity. Sent as the GraphQL `tenantId`
   * arg; the API re-derives tenant from the turn reference and rejects a
   * mismatch, so this is a checked assertion, not a trusted one.
   */
  tenantId: string;
  /** The current turn's `thread_turns.id` (payload.thread_turn_id). */
  threadTurnId?: string;
  /** Fallback turn-bound reference: the current thread id. */
  threadId?: string;
  /** Request timeout in ms (default 12_000). Single attempt, no retry. */
  timeoutMs?: number;
  /** Test seam: override the global fetch implementation. */
  fetchImpl?: typeof fetch;
}

export class ApiSearchProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiSearchProviderError";
  }
}

function requireScope(options: ApiSearchProviderOptions): void {
  if (!options.apiUrl?.trim()) {
    throw new ApiSearchProviderError(
      "Search provider constructed without an apiUrl.",
    );
  }
  if (!options.apiSecret?.trim()) {
    throw new ApiSearchProviderError(
      "Search provider constructed without an apiSecret.",
    );
  }
  if (!options.tenantId?.trim()) {
    throw new ApiSearchProviderError(
      "Search provider constructed without a tenantId.",
    );
  }
  if (!options.threadTurnId?.trim() && !options.threadId?.trim()) {
    throw new ApiSearchProviderError(
      "Search provider constructed without a turn-bound reference " +
        "(threadTurnId or threadId).",
    );
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Render one leg's hits into compact, source-appropriate lines. */
function legToResult(raw: unknown): SearchLegResult | null {
  if (!raw || typeof raw !== "object") return null;
  const leg = raw as Record<string, unknown>;
  const source = str(leg.source);
  const status = str(leg.status);
  if (!source || !status) return null;

  const lines: string[] = [];
  const arr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

  for (const hit of arr(leg.threadHits)) {
    const title = str(hit.title) ?? str(hit.identifier) ?? "(untitled thread)";
    const id = str(hit.identifier);
    lines.push(id ? `${title} [${id}]` : title);
  }
  for (const hit of arr(leg.entityHits)) {
    const label = str(hit.label) ?? "(entity)";
    const type = str(hit.ontologyTypeSlug);
    const summary = str(hit.summary);
    const head = type ? `${label} (${type})` : label;
    lines.push(summary ? `${head} — ${summary}` : head);
  }
  for (const hit of arr(leg.memoryHits)) {
    const text = str(hit.text) ?? "";
    const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    lines.push(snippet || "(memory)");
  }

  return { source, status, lines };
}

/**
 * Build a platform-API-backed {@link SearchProvider}. Identity
 * (apiUrl/apiSecret/tenant/turn reference) is captured here at construction
 * time and never re-read from the environment mid-turn.
 */
export function createApiSearchProvider(
  options: ApiSearchProviderOptions,
): SearchProvider {
  requireScope(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.apiUrl.replace(/\/+$/, "")}/graphql`;
  const turnHeaders: Record<string, string> = options.threadTurnId?.trim()
    ? { "x-thread-turn-id": options.threadTurnId.trim() }
    : { "x-thread-id": options.threadId!.trim() };

  return {
    async search(
      request: SearchProviderRequest,
      signal?: AbortSignal,
    ): Promise<SearchProviderResult> {
      const query = request.query?.trim();
      if (!query) {
        throw new ApiSearchProviderError("search called with an empty query.");
      }
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
            variables: {
              tenantId: options.tenantId,
              query,
              sources: request.sources ?? null,
              limit: request.limit ?? null,
            },
          }),
          signal: attemptSignal,
        });
      } catch (err) {
        throw new ApiSearchProviderError(
          `Search transport error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      const text = await response.text();
      if (!response.ok) {
        throw new ApiSearchProviderError(
          `Search API ${response.status}: ${text.slice(0, 400)}`,
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        throw new ApiSearchProviderError(
          "Search API returned a non-JSON response.",
        );
      }
      const record = (payload ?? {}) as Record<string, unknown>;
      if (Array.isArray(record.errors) && record.errors.length > 0) {
        const first = record.errors[0] as Record<string, unknown> | undefined;
        const message =
          typeof first?.message === "string" ? first.message : "unknown error";
        throw new ApiSearchProviderError(`Search query failed: ${message}`);
      }
      const data = (record.data ?? {}) as Record<string, unknown>;
      const result = (data.search ?? {}) as Record<string, unknown>;
      const legs = Array.isArray(result.legs) ? result.legs : [];
      return {
        legs: legs
          .map(legToResult)
          .filter((leg): leg is SearchLegResult => leg !== null),
      };
    },
  };
}
