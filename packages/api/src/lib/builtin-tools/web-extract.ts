import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantBuiltinTools } from "@thinkwork/database-pg/schema";
import { resolveBuiltinToolApiKey } from "./web-search.js";

export type WebExtractProvider = "firecrawl";

export interface TenantWebExtractConfig {
  toolSlug: "web-extract";
  provider: WebExtractProvider;
  apiKey: string;
  config: Record<string, unknown> | null;
  secretRef: string | null;
}

export interface FirecrawlScrapeResult {
  url: string;
  title?: string;
  markdown: string | null;
  metadata: Record<string, unknown> | null;
}

interface TenantBuiltinToolRow {
  tool_slug: string;
  provider: string | null;
  enabled: boolean;
  config: unknown;
  secret_ref: string | null;
}

interface WebExtractDeps {
  db?: {
    select(): {
      from(table: unknown): {
        where(predicate: unknown): Promise<TenantBuiltinToolRow[]>;
      };
    };
  };
  resolveSecret?: (secretRef: string) => Promise<string | null>;
}

export async function loadTenantWebExtractConfig(
  tenantId: string,
  deps: WebExtractDeps = {},
): Promise<TenantWebExtractConfig | null> {
  const rows = await (deps.db ?? getDb())
    .select()
    .from(tenantBuiltinTools)
    .where(
      and(
        eq(tenantBuiltinTools.tenant_id, tenantId),
        eq(tenantBuiltinTools.tool_slug, "web-extract"),
        eq(tenantBuiltinTools.enabled, true),
      ),
    );
  const row = rows[0];
  if (
    !row?.enabled ||
    row.tool_slug !== "web-extract" ||
    row.provider !== "firecrawl" ||
    !row.secret_ref
  ) {
    return null;
  }

  const apiKey = await (deps.resolveSecret ?? resolveBuiltinToolApiKey)(
    row.secret_ref,
  );
  if (!apiKey) return null;

  return {
    toolSlug: "web-extract",
    provider: "firecrawl",
    apiKey,
    config: recordOrNull(row.config),
    secretRef: row.secret_ref,
  };
}

export async function runFirecrawlScrape(args: {
  provider: WebExtractProvider;
  apiKey: string;
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<FirecrawlScrapeResult> {
  if (args.provider !== "firecrawl") {
    throw new Error(`Unsupported Web Extraction provider '${args.provider}'`);
  }
  const url = normalizePublicUrl(args.url);
  const response = await (args.fetchImpl ?? fetch)(
    "https://api.firecrawl.dev/v2/scrape",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
        "User-Agent": "Thinkwork/1.0",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok || firecrawlFailed(payload)) {
    throw new Error(
      firecrawlErrorMessage(payload, response.status, args.apiKey),
    );
  }

  return normalizeFirecrawlScrape(payload, url);
}

function normalizeFirecrawlScrape(
  payload: unknown,
  requestedUrl: string,
): FirecrawlScrapeResult {
  const root = recordOrNull(payload);
  const data = recordOrNull(root?.data) ?? root;
  const metadata = recordOrNull(data?.metadata);
  const markdown = stringValue(data?.markdown) ?? stringValue(data?.content);
  const sourceUrl =
    stringValue(metadata?.sourceURL) ??
    stringValue(metadata?.sourceUrl) ??
    stringValue(metadata?.url) ??
    requestedUrl;
  const title = stringValue(metadata?.title) ?? stringValue(data?.title);

  return {
    url: sourceUrl,
    title: title ?? undefined,
    markdown,
    metadata,
  };
}

function firecrawlFailed(payload: unknown): boolean {
  const root = recordOrNull(payload);
  return root?.success === false;
}

function firecrawlErrorMessage(
  payload: unknown,
  status: number,
  apiKey: string,
): string {
  const root = recordOrNull(payload);
  const data = recordOrNull(root?.data);
  const raw =
    stringValue(root?.error) ||
    stringValue(root?.message) ||
    stringValue(data?.error) ||
    stringValue(data?.message) ||
    `Firecrawl ${status}: scrape test failed`;
  return redact(raw, apiKey).slice(0, 240);
}

function normalizePublicUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error("url must use https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("url must not contain credentials");
  }
  return parsed.toString();
}

function redact(value: string, apiKey: string): string {
  return apiKey ? value.split(apiKey).join("[redacted]") : value;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
