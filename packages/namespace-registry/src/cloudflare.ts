/**
 * Cloudflare DNS client for the thinkwork.ai namespace zone.
 *
 * Mirrors the REST mechanics of scripts/cloudflare-sync-mcp.ts (zone lookup
 * via GET /zones?name=, record list/create/delete, bearer token), but takes
 * an injected fetch so the core and tests never need network access. The
 * token comes from the caller (the CLI reads CLOUDFLARE_API_TOKEN from env,
 * matching CI; the API Lambda resolves its own zone-scoped token — KTD7).
 */

export const CF_BASE = "https://api.cloudflare.com/client/v4";

/** The apex zone every namespace record lives in. */
export const THINKWORK_APEX_ZONE = "thinkwork.ai";

/** Cloudflare error code that historically means the API token drifted. */
export const CF_ERROR_CODE_TOKEN_DRIFT = 10000;

export interface CloudflareError {
  code: number;
  message: string;
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  comment: string | null;
  ttl?: number;
}

export interface CreateRecordInput {
  type: string;
  name: string;
  content: string;
  comment: string;
  ttl?: number;
}

/**
 * The DNS surface the namespace core needs. CloudflareNamespaceClient is
 * the production implementation; tests inject fakes.
 */
export interface NamespaceDnsApi {
  /** Every record (any type) at exactly this FQDN. */
  listRecords(fqdn: string): Promise<DnsRecord[]>;
  createRecord(input: CreateRecordInput): Promise<DnsRecord>;
  deleteRecord(id: string): Promise<void>;
}

export class CloudflareApiError extends Error {
  readonly status: number;
  readonly errors: CloudflareError[];
  /** Raw response body, surfaced verbatim to the operator. */
  readonly body: string;

  constructor(args: {
    method: string;
    path: string;
    status: number;
    errors: CloudflareError[];
    body: string;
  }) {
    super(
      `Cloudflare API ${args.method} ${args.path} failed: ${args.status}\n${args.body}`,
    );
    this.name = "CloudflareApiError";
    this.status = args.status;
    this.errors = args.errors;
    this.body = args.body;
  }

  get isTokenDrift(): boolean {
    return this.errors.some((e) => e.code === CF_ERROR_CODE_TOKEN_DRIFT);
  }
}

/**
 * Formats a Cloudflare failure for operator output: the full error body,
 * plus the token-drift note when error code 10000 is present (CI has been
 * burned by silent token drift before — make the signature obvious).
 */
export function formatCloudflareError(err: unknown): string {
  if (!(err instanceof CloudflareApiError)) {
    return err instanceof Error ? err.message : String(err);
  }
  let out = err.message;
  if (err.isTokenDrift) {
    out +=
      "\nNote: Cloudflare error 10000 usually means the API token has drifted " +
      "(rotated or revoked). Mint a fresh token with Zone.DNS:Edit on " +
      `${THINKWORK_APEX_ZONE} and update CLOUDFLARE_API_TOKEN.`;
  }
  return out;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: CloudflareError[];
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    /** Abort signal for the request timeout; injected fakes may ignore it. */
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * Default per-request timeout. The api Lambda's signup path calls this
 * client synchronously with the user's request — without a deadline a
 * hung Cloudflare connection would ride out the whole Lambda timeout.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

export interface CloudflareClientOptions {
  token: string;
  zoneName?: string;
  fetchImpl?: FetchLike;
  /** Per-request deadline in milliseconds (default {@link DEFAULT_REQUEST_TIMEOUT_MS}). */
  timeoutMs?: number;
}

export class CloudflareNamespaceClient implements NamespaceDnsApi {
  private readonly token: string;
  private readonly zoneName: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private zoneId: string | null = null;

  constructor(options: CloudflareClientOptions) {
    this.token = options.token;
    this.zoneName = options.zoneName ?? THINKWORK_APEX_ZONE;
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const timeoutError = () =>
      new Error(
        `Cloudflare API ${method} ${path} timed out after ${this.timeoutMs}ms`,
      );

    let res: Awaited<ReturnType<FetchLike>>;
    let text: string;
    try {
      const attempt = (async () => {
        const r = await this.fetchImpl(`${CF_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        return { r, t: await r.text() };
      })();
      // Race the abort event too, so the deadline holds even when an
      // injected fetch ignores `signal`. (Promise.race consumes the losing
      // promise's rejection — no unhandled-rejection leak.)
      const deadline = new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(timeoutError()),
          { once: true },
        );
      });
      const settled = await Promise.race([attempt, deadline]);
      res = settled.r;
      text = settled.t;
    } catch (err) {
      // Translate the native fetch AbortError into our clear message.
      if (controller.signal.aborted) throw timeoutError();
      throw err;
    } finally {
      clearTimeout(timer);
    }
    let parsed: CloudflareEnvelope<T> | null = null;
    try {
      parsed = JSON.parse(text) as CloudflareEnvelope<T>;
    } catch {
      parsed = null;
    }
    if (!res.ok || !parsed || parsed.success === false) {
      throw new CloudflareApiError({
        method,
        path,
        status: res.status,
        errors: parsed?.errors ?? [],
        body: text,
      });
    }
    return parsed.result;
  }

  private async resolveZoneId(): Promise<string> {
    if (this.zoneId) return this.zoneId;
    const zones = await this.request<Array<{ id: string; name: string }>>(
      "GET",
      `/zones?name=${encodeURIComponent(this.zoneName)}`,
    );
    const match = zones.find((z) => z.name === this.zoneName);
    if (!match) {
      throw new Error(
        `Cloudflare zone for "${this.zoneName}" not found. ` +
          "Check the token has access to this zone.",
      );
    }
    this.zoneId = match.id;
    return match.id;
  }

  async listRecords(fqdn: string): Promise<DnsRecord[]> {
    const zoneId = await this.resolveZoneId();
    const records = await this.request<
      Array<{
        id: string;
        type: string;
        name: string;
        content: string;
        comment?: string | null;
        ttl?: number;
      }>
    >(
      "GET",
      `/zones/${zoneId}/dns_records?name=${encodeURIComponent(fqdn)}&per_page=100`,
    );
    return records.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      comment: r.comment ?? null,
      ttl: r.ttl,
    }));
  }

  async createRecord(input: CreateRecordInput): Promise<DnsRecord> {
    const zoneId = await this.resolveZoneId();
    const created = await this.request<{
      id: string;
      type: string;
      name: string;
      content: string;
      comment?: string | null;
      ttl?: number;
    }>("POST", `/zones/${zoneId}/dns_records`, {
      type: input.type,
      name: input.name,
      content: input.content,
      comment: input.comment,
      ttl: input.ttl ?? 1, // 1 = "Automatic" on Cloudflare
      proxied: false,
    });
    return {
      id: created.id,
      type: created.type,
      name: created.name,
      content: created.content,
      comment: created.comment ?? null,
      ttl: created.ttl,
    };
  }

  async deleteRecord(id: string): Promise<void> {
    const zoneId = await this.resolveZoneId();
    await this.request<{ id: string }>(
      "DELETE",
      `/zones/${zoneId}/dns_records/${id}`,
    );
  }
}
