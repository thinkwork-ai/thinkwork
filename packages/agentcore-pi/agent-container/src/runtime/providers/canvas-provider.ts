import type {
  CanvasCheckoutResult,
  CanvasProvider,
  CanvasRefreshResult,
  CanvasSaveRequest,
  CanvasSaveResult,
  CanvasSummaryItem,
  CanvasThreadContext,
  CanvasWritableSpace,
} from "@thinkwork/pi-runtime-core";

/**
 * THINK-145 U9 — platform-API-backed {@link CanvasProvider}.
 *
 * The cloud host constructs this per invocation with identity snapshotted at
 * loop entry (apiUrl/apiSecret/tenantId/threadId/actingUserId from the
 * invocation payload — never re-read from `process.env` mid-turn), then hands
 * it to the `artifacts` extension through the provider bundle. Only THIS module
 * knows the platform GraphQL shape, so the extension stays host-agnostic.
 *
 * Identity seam (KTD8): `createLambdaCallbackFetch`/the service secret carries
 * no verified user principal. This provider asserts the acting user via the
 * `x-principal-id` header (the trusted-infra apikey path) alongside
 * `x-tenant-id`. The server resolves that header to a user and runs the SAME
 * R15 membership gate the web `saveCanvas`/`checkoutCanvas`/`refreshCanvasData`
 * mutations run — never against the service principal alone. A bare `service`
 * caller (no principal) is rejected server-side, so a missing actingUserId
 * fails loud rather than ghost-writing.
 *
 * Transport: a single attempt with a bounded timeout per call. Composes the
 * caller's abort signal with the timeout so a user abort still wins.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

const CANVAS_SUMMARY_FIELDS = /* GraphQL */ `
  artifactId
  title
  updatedAt
  headVersion
  status
  stablePartId
`;

const CONTEXT_QUERY = /* GraphQL */ `
  query ThreadCanvasContext($threadId: ID!) {
    threadCanvasContext(threadId: $threadId) {
      spaceId
      spaceName
      currentCanvas { ${CANVAS_SUMMARY_FIELDS} }
      savedCanvases { ${CANVAS_SUMMARY_FIELDS} }
      writableSpaces { spaceId name }
    }
  }
`;

const SAVE_MUTATION = /* GraphQL */ `
  mutation SaveCanvas($artifactId: ID!, $title: String!, $spaceId: ID!) {
    saveCanvas(artifactId: $artifactId, title: $title, spaceId: $spaceId) {
      id
      title
      spaceId
      headVersion
    }
  }
`;

const CHECKOUT_MUTATION = /* GraphQL */ `
  mutation CheckoutCanvas($artifactId: ID!, $threadId: ID!) {
    checkoutCanvas(artifactId: $artifactId, threadId: $threadId) {
      id
      title
    }
  }
`;

const REFRESH_MUTATION = /* GraphQL */ `
  mutation RefreshCanvasData($artifactId: ID!, $partId: String) {
    refreshCanvasData(artifactId: $artifactId, partId: $partId) {
      artifactId
      dispatched
      errorMessage
      bindings {
        bindingId
        partId
        elementId
        outcome
        quality
        reason
        serverName
        toolName
      }
    }
  }
`;

export interface ApiCanvasProviderOptions {
  /** Platform API base URL (payload.thinkwork_api_url). Required. */
  apiUrl: string;
  /** Service bearer secret (payload.thinkwork_api_secret). Required. */
  apiSecret: string;
  /** Tenant id (identity.tenantId). Required — sent as `x-tenant-id`. */
  tenantId: string;
  /** Current thread id (identity.threadId). Required — checkout/refresh target. */
  threadId: string;
  /**
   * The acting user's id (identity.userId). Required — sent as `x-principal-id`
   * so the server gates space-membership against THIS user (KTD8), not the
   * bare service principal.
   */
  actingUserId: string;
  /** Request timeout in ms (default 15_000). Single attempt, no retry. */
  timeoutMs?: number;
  /** Test seam: override the global fetch implementation. */
  fetchImpl?: typeof fetch;
}

export class ApiCanvasProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiCanvasProviderError";
  }
}

function requireScope(options: ApiCanvasProviderOptions): void {
  const missing: string[] = [];
  if (!options.apiUrl?.trim()) missing.push("apiUrl");
  if (!options.apiSecret?.trim()) missing.push("apiSecret");
  if (!options.tenantId?.trim()) missing.push("tenantId");
  if (!options.threadId?.trim()) missing.push("threadId");
  if (!options.actingUserId?.trim()) missing.push("actingUserId");
  if (missing.length > 0) {
    throw new ApiCanvasProviderError(
      `Canvas provider constructed without: ${missing.join(", ")}.`,
    );
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toSummary(raw: unknown): CanvasSummaryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.artifactId !== "string") return null;
  return {
    artifactId: record.artifactId,
    title: asString(record.title),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
    headVersion:
      typeof record.headVersion === "number" ? record.headVersion : 0,
    status: asString(record.status) || "final",
    stablePartId:
      typeof record.stablePartId === "string" && record.stablePartId
        ? record.stablePartId
        : null,
  };
}

function toWritableSpace(raw: unknown): CanvasWritableSpace | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.spaceId !== "string" || typeof record.name !== "string") {
    return null;
  }
  return { spaceId: record.spaceId, name: record.name };
}

/**
 * Build a platform-API-backed {@link CanvasProvider}. Identity is captured at
 * construction and never re-read from the environment mid-turn.
 */
export function createApiCanvasProvider(
  options: ApiCanvasProviderOptions,
): CanvasProvider {
  requireScope(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${options.apiUrl.replace(/\/+$/, "")}/graphql`;

  async function execute<T>(
    query: string,
    variables: Record<string, unknown>,
    resultField: string,
    signal: AbortSignal | undefined,
    map: (data: unknown) => T,
  ): Promise<T> {
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
          // KTD8 identity seam: assert the acting user + tenant so the server
          // gates R15 membership against this user, not the service principal.
          "x-principal-id": options.actingUserId,
          "x-tenant-id": options.tenantId,
          "user-agent": "Thinkwork-AgentCore-Pi/1.0",
        },
        body: JSON.stringify({ query, variables }),
        signal: attemptSignal,
      });
    } catch (err) {
      throw new ApiCanvasProviderError(
        `Canvas API transport error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw new ApiCanvasProviderError(
        `Canvas API ${response.status}: ${text.slice(0, 400)}`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiCanvasProviderError(
        "Canvas API returned a non-JSON response.",
      );
    }
    const record = (payload ?? {}) as Record<string, unknown>;
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      const first = record.errors[0] as Record<string, unknown> | undefined;
      const message =
        typeof first?.message === "string" ? first.message : "unknown error";
      throw new ApiCanvasProviderError(`Canvas API error: ${message}`);
    }
    const data = (record.data ?? {}) as Record<string, unknown>;
    return map(data[resultField]);
  }

  return {
    async context(signal?: AbortSignal): Promise<CanvasThreadContext> {
      return execute(
        CONTEXT_QUERY,
        { threadId: options.threadId },
        "threadCanvasContext",
        signal,
        (raw): CanvasThreadContext => {
          const record = (raw ?? {}) as Record<string, unknown>;
          return {
            spaceId: typeof record.spaceId === "string" ? record.spaceId : null,
            spaceName:
              typeof record.spaceName === "string" ? record.spaceName : null,
            currentCanvas: toSummary(record.currentCanvas),
            savedCanvases: (Array.isArray(record.savedCanvases)
              ? record.savedCanvases
              : []
            )
              .map(toSummary)
              .filter((item): item is CanvasSummaryItem => item !== null),
            writableSpaces: (Array.isArray(record.writableSpaces)
              ? record.writableSpaces
              : []
            )
              .map(toWritableSpace)
              .filter((item): item is CanvasWritableSpace => item !== null),
          };
        },
      );
    },

    async save(
      request: CanvasSaveRequest,
      signal?: AbortSignal,
    ): Promise<CanvasSaveResult> {
      return execute(
        SAVE_MUTATION,
        {
          artifactId: request.artifactId,
          title: request.title,
          spaceId: request.spaceId,
        },
        "saveCanvas",
        signal,
        (raw): CanvasSaveResult => {
          const record = (raw ?? {}) as Record<string, unknown>;
          return {
            artifactId: asString(record.id) || request.artifactId,
            title: asString(record.title) || request.title,
            spaceId: typeof record.spaceId === "string" ? record.spaceId : null,
            headVersion:
              typeof record.headVersion === "number" ? record.headVersion : 0,
          };
        },
      );
    },

    async checkout(
      artifactId: string,
      signal?: AbortSignal,
    ): Promise<CanvasCheckoutResult> {
      return execute(
        CHECKOUT_MUTATION,
        { artifactId, threadId: options.threadId },
        "checkoutCanvas",
        signal,
        (raw): CanvasCheckoutResult => {
          const record = (raw ?? {}) as Record<string, unknown>;
          return {
            artifactId: asString(record.id) || artifactId,
            title: asString(record.title),
          };
        },
      );
    },

    async refresh(
      artifactId: string,
      partId?: string | null,
      signal?: AbortSignal,
    ): Promise<CanvasRefreshResult> {
      return execute(
        REFRESH_MUTATION,
        { artifactId, partId: partId ?? null },
        "refreshCanvasData",
        signal,
        (raw): CanvasRefreshResult => {
          const record = (raw ?? {}) as Record<string, unknown>;
          return {
            artifactId: asString(record.artifactId) || artifactId,
            dispatched: record.dispatched === true,
            errorMessage:
              typeof record.errorMessage === "string"
                ? record.errorMessage
                : null,
            bindings: (Array.isArray(record.bindings) ? record.bindings : [])
              .map((entry) => {
                if (!entry || typeof entry !== "object") return null;
                const b = entry as Record<string, unknown>;
                return {
                  bindingId: asString(b.bindingId),
                  partId: asString(b.partId),
                  elementId: asString(b.elementId),
                  outcome: asString(b.outcome),
                  quality: asString(b.quality),
                  reason: typeof b.reason === "string" ? b.reason : null,
                  serverName: asString(b.serverName),
                  toolName: asString(b.toolName),
                };
              })
              .filter(
                (item): item is CanvasRefreshResult["bindings"][number] =>
                  item !== null,
              ),
          };
        },
      );
    },
  };
}
