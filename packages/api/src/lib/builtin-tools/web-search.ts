import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantBuiltinTools } from "@thinkwork/database-pg/schema";

export type WebSearchProvider = "exa" | "serpapi";

export interface TenantWebSearchConfig {
  toolSlug: "web-search";
  provider: WebSearchProvider;
  apiKey: string;
  config: Record<string, unknown> | null;
  secretRef: string | null;
}

export interface WebSearchResult {
  id?: string;
  title: string;
  url?: string;
  snippet: string;
  score?: number | null;
  raw: unknown;
}

interface TenantBuiltinToolRow {
  tool_slug: string;
  provider: string | null;
  enabled: boolean;
  config: unknown;
  secret_ref: string | null;
}

interface WebSearchDeps {
  db?: {
    select(): {
      from(table: unknown): {
        where(predicate: unknown): Promise<TenantBuiltinToolRow[]>;
      };
    };
  };
  resolveSecret?: (secretRef: string) => Promise<string | null>;
}

const sm = new SecretsManagerClient({});

export function builtinToolSecretName(
  stage: string,
  tenantId: string,
  slug: string,
): string {
  return `thinkwork/${stage}/tenant/${tenantId}/builtin/${slug}`;
}

export async function resolveBuiltinToolApiKey(
  secretRef: string,
  client: Pick<SecretsManagerClient, "send"> = sm,
): Promise<string | null> {
  try {
    const res = await client.send(
      new GetSecretValueCommand({ SecretId: secretRef }),
    );
    if (!res.SecretString) return null;
    const parsed = JSON.parse(res.SecretString) as { token?: string };
    return typeof parsed.token === "string" && parsed.token.trim()
      ? parsed.token
      : null;
  } catch (err) {
    console.warn(
      `[builtin-tools] Failed to fetch secret ${secretRef}: ${(err as Error).message}`,
    );
    return null;
  }
}

export async function loadTenantWebSearchConfig(
  tenantId: string,
  deps: WebSearchDeps = {},
): Promise<TenantWebSearchConfig | null> {
  const rows = await (deps.db ?? getDb())
    .select()
    .from(tenantBuiltinTools)
    .where(
      and(
        eq(tenantBuiltinTools.tenant_id, tenantId),
        eq(tenantBuiltinTools.tool_slug, "web-search"),
        eq(tenantBuiltinTools.enabled, true),
      ),
    );
  const row = rows[0];
  if (!row?.enabled || row.tool_slug !== "web-search" || !row.secret_ref) {
    return null;
  }

  const provider = normalizeWebSearchProvider(row.provider);
  const apiKey = await (deps.resolveSecret ?? resolveBuiltinToolApiKey)(
    row.secret_ref,
  );
  if (!apiKey) return null;

  return {
    toolSlug: "web-search",
    provider,
    apiKey,
    config: recordOrNull(row.config),
    secretRef: row.secret_ref,
  };
}

/** Load enabled built-in tools for a tenant, with API keys resolved from Secrets Manager. */
export async function loadTenantBuiltinTools(
  tenantId: string,
  deps: WebSearchDeps = {},
): Promise<
  Array<{
    toolSlug: string;
    provider: string | null;
    envOverrides: Record<string, string>;
  }>
> {
  const webSearch = await loadTenantWebSearchConfig(tenantId, deps);
  if (!webSearch) return [];
  return [
    {
      toolSlug: webSearch.toolSlug,
      provider: webSearch.provider,
      envOverrides: buildWebSearchEnvOverrides(webSearch),
    },
  ];
}

export function buildWebSearchEnvOverrides(
  config: TenantWebSearchConfig,
): Record<string, string> {
  return {
    WEB_SEARCH_PROVIDER: config.provider,
    ...(config.provider === "exa"
      ? { EXA_API_KEY: config.apiKey }
      : { SERPAPI_KEY: config.apiKey }),
  };
}

export async function runWebSearch(args: {
  provider: WebSearchProvider;
  apiKey: string;
  query: string;
  limit: number;
  fetchImpl?: typeof fetch;
}): Promise<WebSearchResult[]> {
  const limit = Math.max(1, Math.min(Math.floor(args.limit || 5), 10));
  if (args.provider === "serpapi") {
    return runSerpApiSearch({ ...args, limit });
  }
  return runExaSearch({ ...args, limit });
}

async function runExaSearch(args: {
  apiKey: string;
  query: string;
  limit: number;
  fetchImpl?: typeof fetch;
}): Promise<WebSearchResult[]> {
  const response = await (args.fetchImpl ?? fetch)(
    "https://api.exa.ai/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": args.apiKey,
        "User-Agent": "Thinkwork/1.0",
      },
      body: JSON.stringify({ query: args.query, numResults: args.limit }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    results?: unknown[];
    error?: string;
  };
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error ||
        `Exa ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`,
    );
  }

  return (Array.isArray(payload.results) ? payload.results : [])
    .slice(0, args.limit)
    .map((item, index) => normalizeExaResult(item, index))
    .filter((item): item is WebSearchResult => item !== null);
}

async function runSerpApiSearch(args: {
  apiKey: string;
  query: string;
  limit: number;
  fetchImpl?: typeof fetch;
}): Promise<WebSearchResult[]> {
  const params = new URLSearchParams({
    engine: "google",
    q: args.query,
    num: String(args.limit),
    api_key: args.apiKey,
  });
  const response = await (args.fetchImpl ?? fetch)(
    `https://serpapi.com/search.json?${params}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    organic_results?: unknown[];
    error?: string;
  };
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error ||
        `SerpAPI ${response.status}: ${JSON.stringify(payload).slice(0, 200)}`,
    );
  }

  return (Array.isArray(payload.organic_results) ? payload.organic_results : [])
    .slice(0, args.limit)
    .map((item, index) => normalizeSerpApiResult(item, index))
    .filter((item): item is WebSearchResult => item !== null);
}

function normalizeExaResult(
  item: unknown,
  index: number,
): WebSearchResult | null {
  const record = recordOrNull(item);
  if (!record) return null;
  const title = stringValue(record.title) || stringValue(record.url);
  const snippet =
    stringValue(record.text) ||
    stringValue(record.summary) ||
    stringValue(record.highlights);
  if (!title || !snippet) return null;
  return {
    id: stringValue(record.id) ?? String(index + 1),
    title,
    url: stringValue(record.url) ?? undefined,
    snippet: snippet.slice(0, 700),
    score: numberValue(record.score) ?? 1 / (index + 1),
    raw: item,
  };
}

function normalizeSerpApiResult(
  item: unknown,
  index: number,
): WebSearchResult | null {
  const record = recordOrNull(item);
  if (!record) return null;
  const title = stringValue(record.title) || stringValue(record.link);
  const snippet =
    stringValue(record.snippet) || stringValue(record.rich_snippet);
  if (!title || !snippet) return null;
  return {
    id: stringValue(record.position) ?? String(index + 1),
    title,
    url: stringValue(record.link) ?? undefined,
    snippet: snippet.slice(0, 700),
    score: 1 / ((numberValue(record.position) ?? index + 1) || 1),
    raw: item,
  };
}

function normalizeWebSearchProvider(
  provider: string | null,
): WebSearchProvider {
  return provider === "serpapi" ? "serpapi" : "exa";
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
