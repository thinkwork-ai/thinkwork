/**
 * Reusable, tenant-safe Twenty CRM REST client.
 *
 * Extracted from `handlers/twenty-client-engagement.ts` (behavior preserved)
 * and extended with cursor-paginated listing (`listPage`) and workspace
 * metadata discovery (`getMetadataObjects`) for memory-source adapters.
 */
import { and, desc, eq, or } from "drizzle-orm";
import { schema, type Database } from "@thinkwork/database-pg";
import { createPluginDispatchAuthResolver } from "../plugins/activation.js";

const { managedApplications, tenantMcpServers } = schema;

export const TWENTY_MCP_SLUG = "twenty--crm";

const DEFAULT_LOG_PREFIX = "[twenty-rest-client]";
const DEFAULT_TIMEOUT_MS = 15000;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type TwentyPageInfo = {
  hasNextPage?: boolean;
  endCursor?: string;
};

export type TwentyListPage<T> = {
  records: T[];
  pageInfo?: TwentyPageInfo | undefined;
  /** Raw parsed response body, for callers that need shapes we don't model. */
  payload: unknown;
};

export type TwentyRestClientOptions = {
  timeoutMs?: number;
};

export type TwentyListPageOptions = {
  limit?: number;
  depth?: 0 | 1;
  /** Cursor from a previous page's `pageInfo.endCursor`. */
  startingAfter?: string;
  /** Twenty REST filter expression, e.g. `updatedAt[gte]:2026-01-01T00:00:00Z`. */
  filter?: string;
  /** Twenty REST ordering, e.g. `updatedAt[AscNullsFirst]`. */
  orderBy?: string;
  /** Keys to probe when unwrapping the record collection from the payload. */
  collectionKeys?: string[];
  /**
   * Escape hatch: extra/override query params. Twenty's exact pagination
   * param names vary by version, so callers can override `starting_after`,
   * `order_by`, etc. Entries here win over the named options above.
   */
  query?: Record<string, string | number | boolean | undefined>;
};

export class TwentyRestClient {
  private readonly timeoutMs: number;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    options: TwentyRestClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async list(
    objectName: string,
    collectionKeys: string[],
    options: { depth?: 0 | 1 } = {},
  ) {
    const depth = options.depth ?? 0;
    const payload = await this.request(
      `${objectName}?limit=200&depth=${depth}`,
      {
        method: "GET",
      },
    );
    return recordsFromPayload(payload, collectionKeys);
  }

  /**
   * Cursor-paginated record listing for incremental sync. Twenty REST
   * accepts `limit`, `depth`, `filter`, `order_by`, and `starting_after`
   * query params and reports `pageInfo.{hasNextPage,endCursor}` under
   * `data` — but param names vary by version, so `options.query` can
   * override anything and the raw payload is returned alongside records.
   */
  async listPage<T extends Record<string, unknown> = Record<string, unknown>>(
    objectPath: string,
    options: TwentyListPageOptions = {},
  ): Promise<TwentyListPage<T>> {
    const params = new URLSearchParams();
    const named: Record<string, string | number | boolean | undefined> = {
      limit: options.limit,
      depth: options.depth,
      filter: options.filter,
      order_by: options.orderBy,
      starting_after: options.startingAfter,
    };
    for (const [key, value] of Object.entries({
      ...named,
      ...(options.query ?? {}),
    })) {
      if (value !== undefined) params.set(key, String(value));
    }
    const queryString = params.toString();
    const payload = await this.request(
      queryString ? `${objectPath}?${queryString}` : objectPath,
      { method: "GET" },
    );
    return {
      records: recordsFromPayload(
        payload,
        options.collectionKeys ?? [objectPath],
      ) as T[],
      pageInfo: pageInfoFromPayload(payload),
      payload,
    };
  }

  /**
   * Workspace metadata discovery (`GET /rest/metadata/objects`). Returns
   * the raw parsed payload; a 404 (endpoint absent on this Twenty version)
   * returns null instead of throwing.
   */
  async getMetadataObjects(): Promise<unknown | null> {
    try {
      return await this.request("metadata/objects", { method: "GET" });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  async post(objectName: string, body: Record<string, unknown>) {
    const payload = await this.request(objectName, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return firstRecordFromPayload(payload) ?? payload;
  }

  async patch(objectPath: string, body: Record<string, unknown>) {
    const payload = await this.request(objectPath, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return firstRecordFromPayload(payload) ?? payload;
  }

  private async request(path: string, init: RequestInit) {
    const url = `${this.baseUrl}/rest/${path.replace(/^\/+/, "")}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    const body = text ? parseJsonResponse(text) : null;
    if (!res.ok) {
      throw new HttpError(
        `Twenty API ${res.status}: ${errorMessage(body) ?? res.statusText}`,
        res.status,
      );
    }
    return body;
  }
}

export type ResolvedTwentyContext = {
  baseUrl: string;
  token: string;
  mcpServer: {
    url: string;
    pluginInstallId: string;
  };
};

/**
 * Resolve the tenant's Twenty deployment (base URL from the managed
 * application's desired_config or the approved MCP server URL) and the
 * caller's per-user bearer token. Returns null when the plugin is not
 * installed for the tenant; throws HttpError 403 when the plugin is
 * installed but the user has not connected their Twenty account.
 */
export async function resolveTwentyContext(
  db: Database,
  args: {
    tenantId: string;
    userId: string;
    logPrefix?: string;
    /**
     * 403 message when the user has no active Twenty connection. Defaults
     * to the Client Engagement wording; callers on other surfaces (e.g.
     * memory ingestion) pass their own so the error points at the right
     * feature.
     */
    unauthorizedMessage?: string;
  },
): Promise<ResolvedTwentyContext | null> {
  const [mcpServer] = await db
    .select({
      url: tenantMcpServers.url,
      plugin_install_id: tenantMcpServers.plugin_install_id,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, args.tenantId),
        eq(tenantMcpServers.enabled, true),
        eq(tenantMcpServers.status, "approved"),
        or(
          eq(tenantMcpServers.slug, TWENTY_MCP_SLUG),
          eq(tenantMcpServers.managed_application_key, "twenty"),
        ),
      ),
    )
    .limit(1);

  const [app] = await db
    .select({ desired_config: managedApplications.desired_config })
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, args.tenantId),
        eq(managedApplications.key, "twenty"),
      ),
    )
    .orderBy(desc(managedApplications.updated_at))
    .limit(1);

  const baseUrl =
    publicHttpUrl(recordOrNull(app?.desired_config)?.publicUrl) ??
    baseUrlFromMcpUrl(mcpServer?.url);
  if (!baseUrl || !mcpServer?.url || !mcpServer.plugin_install_id) {
    return null;
  }

  const token = await createPluginDispatchAuthResolver().resolveToken({
    requesterUserId: args.userId,
    pluginInstallId: mcpServer.plugin_install_id,
    resource: mcpServer.url,
    slug: TWENTY_MCP_SLUG,
    logPrefix: args.logPrefix ?? DEFAULT_LOG_PREFIX,
  });
  if (!token) {
    throw new HttpError(
      args.unauthorizedMessage ??
        "Connect your Twenty CRM account before opening Client Engagement",
      403,
    );
  }

  return {
    baseUrl,
    token,
    mcpServer: {
      url: mcpServer.url,
      pluginInstallId: mcpServer.plugin_install_id,
    },
  };
}

export function recordsFromPayload(
  payload: unknown,
  collectionKeys: string[],
): Record<string, unknown>[] {
  const root = recordOrNull(payload);
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!root) return [];
  if (Array.isArray(root.data)) return root.data.filter(isRecord);
  if (Array.isArray(root.records)) return root.records.filter(isRecord);
  const data = recordOrNull(root.data);
  if (data) {
    const nested = recordsFromPayload(data, collectionKeys);
    if (nested.length > 0) return nested;
  }
  for (const key of collectionKeys) {
    const value = root[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    const nested = recordOrNull(value);
    if (nested) {
      const records = recordsFromPayload(nested, collectionKeys);
      if (records.length > 0) return records;
    }
  }
  return typeof root.id === "string" ? [root] : [];
}

export function firstRecordFromPayload(
  payload: unknown,
): Record<string, unknown> | null {
  return recordsFromPayload(payload, [])[0] ?? null;
}

function pageInfoFromPayload(payload: unknown): TwentyPageInfo | undefined {
  const root = recordOrNull(payload);
  if (!root) return undefined;
  const raw =
    recordOrNull(recordOrNull(root.data)?.pageInfo) ??
    recordOrNull(root.pageInfo);
  if (!raw) return undefined;
  const pageInfo: TwentyPageInfo = {};
  if (typeof raw.hasNextPage === "boolean") {
    pageInfo.hasNextPage = raw.hasNextPage;
  }
  const endCursor = stringValue(raw.endCursor);
  if (endCursor) pageInfo.endCursor = endCursor;
  return Object.keys(pageInfo).length > 0 ? pageInfo : undefined;
}

export function errorMessage(body: unknown): string | null {
  const record = recordOrNull(body);
  return (
    stringValue(record?.message) ??
    stringValue(record?.error) ??
    stringValue(record?.detail) ??
    (typeof body === "string" ? body : null)
  );
}

export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(recordOrNull(value));
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function publicHttpUrl(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function baseUrlFromMcpUrl(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/mcp\/?$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}
