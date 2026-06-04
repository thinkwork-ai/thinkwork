import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface WebExtractConfig {
  provider?: unknown;
  apiKey?: unknown;
  config?: unknown;
}

export interface WebExtractExtensionOptions {
  webExtractConfig?: WebExtractConfig | null;
  fetchImpl?: FetchLike;
  maxMarkdownChars?: number;
}

interface FirecrawlScrapeResult {
  url: string;
  title?: string;
  markdown: string;
  metadata: Record<string, unknown> | null;
}

const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_MARKDOWN_CHARS = 20_000;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizePublicHttpsUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error("web_extract requires a public HTTPS URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("web_extract URL must not contain credentials.");
  }
  return parsed.toString();
}

function boundedText(value: string, maxChars: number) {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, maxChars), truncated: true };
}

function redact(value: string, apiKey: string): string {
  return apiKey ? value.split(apiKey).join("[redacted]") : value;
}

function errorMessage(error: unknown, apiKey: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redact(raw, apiKey).slice(0, 300);
}

function normalizeFirecrawlScrape(
  payload: unknown,
  requestedUrl: string,
): FirecrawlScrapeResult | null {
  const root = recordOrNull(payload);
  const data = recordOrNull(root?.data) ?? root;
  const metadata = recordOrNull(data?.metadata);
  const markdown = asString(data?.markdown) || asString(data?.content);
  if (!markdown) return null;

  const sourceUrl =
    asString(metadata?.sourceURL) ||
    asString(metadata?.sourceUrl) ||
    asString(metadata?.url) ||
    requestedUrl;
  const title = asString(metadata?.title) || asString(data?.title);
  return {
    url: sourceUrl,
    title: title || undefined,
    markdown,
    metadata,
  };
}

async function firecrawlScrape(args: {
  fetchImpl: FetchLike;
  apiKey: string;
  url: string;
}): Promise<FirecrawlScrapeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await args.fetchImpl(
      "https://api.firecrawl.dev/v2/scrape",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${args.apiKey}`,
          "User-Agent": "Thinkwork/1.0",
        },
        body: JSON.stringify({
          url: args.url,
          formats: ["markdown"],
          onlyMainContent: true,
        }),
        signal: controller.signal,
      },
    );

    const responseText = await response.text().catch(() => "");
    let payload: unknown = {};
    if (responseText) {
      try {
        payload = JSON.parse(responseText) as unknown;
      } catch {
        payload = { error: responseText };
      }
    }
    const root = recordOrNull(payload);
    if (!response.ok || root?.success === false) {
      const data = recordOrNull(root?.data);
      const providerError =
        asString(root?.error) ||
        asString(root?.message) ||
        asString(data?.error) ||
        asString(data?.message) ||
        `Firecrawl scrape failed with HTTP ${response.status}`;
      throw new Error(providerError);
    }

    const normalized = normalizeFirecrawlScrape(payload, args.url);
    if (!normalized) {
      throw new Error("Firecrawl returned no markdown content for this URL.");
    }
    return normalized;
  } finally {
    clearTimeout(timer);
  }
}

export function createWebExtractExtension(
  options: WebExtractExtensionOptions,
): ThinkworkExtension {
  const config = options.webExtractConfig;
  const enabled = typeof config === "object" && config !== null;

  return defineExtension({
    name: "thinkwork-web-extract",
    toolNames: enabled ? ["web_extract"] : [],
    register(pi) {
      if (!enabled) return;

      const provider = (asString(config.provider) || "firecrawl").toLowerCase();
      const apiKey = asString(config.apiKey);
      const fetchImpl = options.fetchImpl ?? fetch;
      const maxMarkdownChars = Math.max(
        1_000,
        Math.min(
          Math.trunc(Number(options.maxMarkdownChars)) ||
            DEFAULT_MAX_MARKDOWN_CHARS,
          50_000,
        ),
      );

      const tool: ToolDefinition = {
        name: "web_extract",
        label: "Web Extraction",
        description:
          "Read and extract clean markdown from a known public HTTPS URL. " +
          "Use this after web_search finds a promising page, or whenever the " +
          "task is to read, summarize, analyze, or quote a normal webpage. " +
          "Use browser_automation only when the page needs interaction, " +
          "rendered-state inspection, or web_extract fails.",
        parameters: Type.Object({
          url: Type.String({
            description: "Known public HTTPS URL to extract.",
          }),
          extraction_goal: Type.Optional(
            Type.String({
              description:
                "Short note about what to focus on while reading the page.",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const typed = (params ?? {}) as Record<string, unknown>;
          const rawUrl = asString(typed.url);
          const extractionGoal = asString(typed.extraction_goal);
          const started = Date.now();

          if (!apiKey) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    provider,
                    error:
                      "Web Extraction is enabled but no Firecrawl API key is configured.",
                  }),
                },
              ],
              details: { ok: false, runtime: "pi", provider },
            };
          }
          if (provider !== "firecrawl") {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    provider,
                    error: `Unsupported Web Extraction provider '${provider}'.`,
                  }),
                },
              ],
              details: { ok: false, runtime: "pi", provider },
            };
          }

          try {
            if (!rawUrl) {
              throw new Error("web_extract requires a non-empty URL.");
            }
            const url = normalizePublicHttpsUrl(rawUrl);
            const result = await firecrawlScrape({ fetchImpl, apiKey, url });
            const bounded = boundedText(result.markdown, maxMarkdownChars);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    provider,
                    url: result.url,
                    title: result.title,
                    extraction_goal: extractionGoal || undefined,
                    markdown: bounded.text,
                    text: bounded.text,
                    metadata: result.metadata,
                    truncated: bounded.truncated,
                    duration_ms: Date.now() - started,
                  }),
                },
              ],
              details: {
                ok: true,
                runtime: "pi",
                provider,
                url: result.url,
                title: result.title,
                truncated: bounded.truncated,
                content_chars: result.markdown.length,
                duration_ms: Date.now() - started,
              },
            };
          } catch (err) {
            const message = errorMessage(err, apiKey);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    provider,
                    url: rawUrl || undefined,
                    error: message,
                    duration_ms: Date.now() - started,
                  }),
                },
              ],
              details: {
                ok: false,
                runtime: "pi",
                provider,
                url: rawUrl || undefined,
                duration_ms: Date.now() - started,
                error: message,
              },
            };
          }
        },
      };

      pi.registerTool(tool);
    },
  });
}
