/**
 * GraphQL client for Twenty CRM used by the LastMile migration script.
 *
 * Follows the TwentyGraphqlClient shape from scripts/wire-thinkwork-workflow.mjs:
 * Bearer auth, `/graphql` (workspace data) + `/metadata` (field metadata), throws
 * on `body.errors`. Adds the retry/backoff and batching discipline from the
 * migration plan (KTD3): reads may auto-retry; mutations are only retried by
 * callers after re-querying, never blindly.
 */

export const BATCH_LIMIT = 60;

export type TwentyEndpointPath = "/graphql" | "/metadata";

export class TwentyGraphqlError extends Error {
  readonly errors: Array<{
    message: string;
    extensions?: Record<string, unknown>;
  }>;
  readonly httpStatus: number | undefined;

  constructor(
    message: string,
    options: {
      errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
      httpStatus?: number;
    } = {},
  ) {
    super(message);
    this.name = "TwentyGraphqlError";
    this.errors = options.errors ?? [];
    this.httpStatus = options.httpStatus;
  }

  get isDuplicateError(): boolean {
    return this.errors.some((error) =>
      /duplicate|unique|already exists/i.test(error.message),
    );
  }

  get isRetryable(): boolean {
    return (
      this.isNetworkError ||
      this.httpStatus === 429 ||
      (this.httpStatus !== undefined && this.httpStatus >= 500)
    );
  }

  isNetworkError = false;
}

export interface TwentyClientOptions {
  /** e.g. https://crm.tei.thinkwork.ai — no trailing slash. */
  baseUrl: string;
  /** Workspace API key or a user access token; sent as Bearer. */
  authToken: string;
  fetchImpl?: typeof fetch;
  /** Base backoff in ms; test seam. */
  backoffMs?: number;
  maxRetries?: number;
}

export function normalizeBaseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error(`Twenty URL must be HTTPS or localhost, got ${url}.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error(`chunk size must be >= 1, got ${size}`);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class TwentyClient {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly backoffMs: number;
  private readonly maxRetries: number;

  constructor(options: TwentyClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.authToken = options.authToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.backoffMs = options.backoffMs ?? 1_000;
    this.maxRetries = options.maxRetries ?? 4;
  }

  endpoint(path: TwentyEndpointPath): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * Single-shot request. No retries — safe for mutations, whose callers must
   * re-query by sourceId before re-attempting (plan KTD3).
   */
  async requestOnce<T = Record<string, unknown>>(
    path: TwentyEndpointPath,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint(path), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (cause) {
      // Socket-level failure (DNS, reset, timeout): no response was received.
      // Reads retry these; mutation callers re-query by sourceId first (KTD3).
      const error = new TwentyGraphqlError(
        `Twenty GraphQL network error: ${cause instanceof Error ? (cause.cause instanceof Error ? cause.cause.message : cause.message) : String(cause)}`,
      );
      error.isNetworkError = true;
      throw error;
    }
    const bodyText = await response.text();
    if (!response.ok) {
      throw new TwentyGraphqlError(
        `Twenty GraphQL HTTP ${response.status}: ${bodyText}`,
        {
          httpStatus: response.status,
        },
      );
    }
    let body: {
      data?: T;
      errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
    };
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new TwentyGraphqlError(
        `Twenty GraphQL returned non-JSON body: ${bodyText.slice(0, 300)}`,
      );
    }
    if (body.errors?.length) {
      throw new TwentyGraphqlError(
        `Twenty GraphQL errors: ${JSON.stringify(body.errors)}`,
        {
          errors: body.errors,
        },
      );
    }
    if (body.data === undefined || body.data === null) {
      throw new TwentyGraphqlError("Twenty GraphQL returned no data.");
    }
    return body.data;
  }

  /**
   * Read request with exponential backoff on 429/5xx. Only use for queries —
   * retrying a mutation blind can double-write (plan KTD3).
   */
  async requestWithRetry<T = Record<string, unknown>>(
    path: TwentyEndpointPath,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.requestOnce<T>(path, query, variables);
      } catch (error) {
        const retryable =
          error instanceof TwentyGraphqlError && error.isRetryable;
        if (!retryable || attempt >= this.maxRetries) throw error;
        const delay =
          this.backoffMs * 2 ** attempt + Math.floor(Math.random() * 250);
        await sleep(delay);
        attempt += 1;
      }
    }
  }
}
