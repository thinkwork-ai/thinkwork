import type {
  CompanyBrainProvider,
  TwinCohortRequest,
  TwinQueryPayload,
} from "@thinkwork/pi-runtime-core";

/**
 * Company Brain U7 — platform-API-backed {@link CompanyBrainProvider}.
 *
 * Mirrors the knowledge-graph provider's transport discipline exactly:
 * identity (apiUrl/apiSecret/turn reference) is snapshotted at construction
 * — never re-read from env mid-turn; the request carries the current
 * `x-thread-turn-id` (or `x-thread-id`) and the API's twin resolvers derive
 * the tenant SERVER-SIDE from it — no tenant assertion travels. SINGLE
 * attempt with a 10s timeout: a degraded twin surfaces as the extension's
 * fixed unavailable text quickly, never a retry ladder.
 *
 * The twin GraphQL queries return AWSJSON payloads
 * (`{ ok, results | reason, detail }` from the VPC twin-query Lambda) —
 * passed through as-is; the extension owns formatting + sanitization.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

const ENTITY_QUERY = /* GraphQL */ `
  query TwinEntity($canonicalId: ID!) {
    twinEntity(canonicalId: $canonicalId)
  }
`;

const NEIGHBORS_QUERY = /* GraphQL */ `
  query TwinNeighbors($canonicalId: ID!, $depth: Int) {
    twinNeighbors(canonicalId: $canonicalId, depth: $depth)
  }
`;

const SYSTEM_EDGES_QUERY = /* GraphQL */ `
  query TwinSystemEdges($canonicalId: ID!) {
    twinSystemEdges(canonicalId: $canonicalId)
  }
`;

const COHORT_QUERY = /* GraphQL */ `
  query TwinCohort($entityType: String!, $filter: AWSJSON!, $limit: Int) {
    twinCohort(entityType: $entityType, filter: $filter, limit: $limit)
  }
`;

export class ApiCompanyBrainProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiCompanyBrainProviderError";
  }
}

export interface ApiCompanyBrainProviderOptions {
  apiUrl: string;
  apiSecret: string;
  threadTurnId?: string;
  threadId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createApiCompanyBrainProvider(
  options: ApiCompanyBrainProviderOptions,
): CompanyBrainProvider {
  if (!options.threadTurnId?.trim() && !options.threadId?.trim()) {
    throw new ApiCompanyBrainProviderError(
      "Company brain provider requires a thread-turn or thread reference.",
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.apiUrl.replace(/\/+$/, "")}/graphql`;
  const turnHeaders: Record<string, string> = options.threadTurnId?.trim()
    ? { "x-thread-turn-id": options.threadTurnId.trim() }
    : { "x-thread-id": options.threadId!.trim() };

  async function execute(
    queryDoc: string,
    variables: Record<string, unknown>,
    resultField: string,
    signal?: AbortSignal,
  ): Promise<TwinQueryPayload> {
    const attemptSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiSecret}`,
        ...turnHeaders,
      },
      body: JSON.stringify({ query: queryDoc, variables }),
      signal: attemptSignal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ApiCompanyBrainProviderError(
        `Company brain API ${response.status}: ${text.slice(0, 400)}`,
        response.status,
      );
    }
    const payload = (text ? JSON.parse(text) : {}) as {
      data?: Record<string, unknown>;
      errors?: Array<{ message?: string }>;
    };
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new ApiCompanyBrainProviderError(
        payload.errors[0]?.message ?? "Company brain query failed.",
      );
    }
    const raw = payload.data?.[resultField];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, reason: "unavailable", detail: "empty_result" };
    }
    return parsed as TwinQueryPayload;
  }

  return {
    getEntity: (request, signal) =>
      execute(
        ENTITY_QUERY,
        { canonicalId: request.canonicalId },
        "twinEntity",
        signal,
      ),
    neighbors: (request, signal) =>
      execute(
        NEIGHBORS_QUERY,
        { canonicalId: request.canonicalId, depth: request.depth ?? 1 },
        "twinNeighbors",
        signal,
      ),
    systemEdges: (request, signal) =>
      execute(
        SYSTEM_EDGES_QUERY,
        { canonicalId: request.canonicalId },
        "twinSystemEdges",
        signal,
      ),
    cohortQuery: (request: TwinCohortRequest, signal) =>
      execute(
        COHORT_QUERY,
        {
          entityType: request.entityType,
          filter: JSON.stringify({
            predicates: request.predicates,
            path: request.path,
          }),
          limit: request.limit ?? 25,
        },
        "twinCohort",
        signal,
      ),
  };
}
