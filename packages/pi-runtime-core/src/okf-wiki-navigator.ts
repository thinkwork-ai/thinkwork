/**
 * OKF Wiki Navigator — host-supplied read-only traversal contract.
 *
 * The core and future Pi extension know only this interface. The cloud host
 * supplies a provider rooted at the current tenant bundle, so model-facing
 * tools never accept tenant ids, S3 keys, credentials, or absolute host paths.
 * Returned markdown is untrusted source data: callers may cite or summarize it,
 * but must never treat it as instructions or as a policy-expansion channel.
 */

export const OKF_WIKI_NAVIGATOR_TOOL_NAMES = [
  "wiki_ls",
  "wiki_rg",
  "wiki_read",
  "wiki_links",
] as const;

export const OKF_WIKI_NAVIGATOR_LIMITS = {
  maxResults: 50,
  maxBytes: 128_000,
  maxDepth: 8,
} as const;

export const OKF_WIKI_CONTEXT_TRACE_EVENT_TYPE = "wiki_context_trace";

const MAX_TRACE_ITEMS = 20;
const MAX_TRACE_STRING_LENGTH = 500;

export interface OkfWikiTraceFallback {
  toolCallId?: string | null;
  toolName?: string | null;
}

export interface OkfWikiContextTrace {
  surface: "okf_efs";
  tool: string;
  tool_call_id?: string;
  query?: string;
  path?: string;
  entries?: unknown[];
  links?: unknown[];
  backlinks?: unknown[];
  bounds?: Record<string, unknown>;
  redaction: {
    source: "okf_navigator";
    policy: "cite_or_summarize_only";
  };
  truncated?: boolean;
  [key: string]: unknown;
}

export interface OkfWikiNavigatorBounds {
  maxResults: number;
  maxBytes: number;
  maxDepth: number;
  truncated: boolean;
}

export interface OkfWikiNavigatorMetadata {
  title?: string;
  type?: string;
  pageKind?: string;
}

export interface OkfWikiNavigatorEntry extends OkfWikiNavigatorMetadata {
  path: string;
  kind: "file" | "directory";
  sizeBytes?: number;
}

export interface OkfWikiNavigatorSearchEntry extends OkfWikiNavigatorMetadata {
  path: string;
  line: number;
  snippet: string;
}

export interface OkfWikiNavigatorLinkEntry extends OkfWikiNavigatorMetadata {
  path: string;
  label?: string;
}

export interface OkfWikiNavigatorReadResult extends OkfWikiNavigatorMetadata {
  path: string;
  content: string;
  offsetBytes: number;
  bytesRead: number;
  startLine?: number;
  endLine?: number;
  truncated: boolean;
  redaction: {
    source: "okf_navigator";
    policy: "cite_or_summarize_only";
  };
}

export interface OkfWikiNavigatorListRequest {
  path?: string;
  maxDepth?: number;
  maxResults?: number;
}

export interface OkfWikiNavigatorListResult {
  entries: OkfWikiNavigatorEntry[];
  bounds: OkfWikiNavigatorBounds;
}

export interface OkfWikiNavigatorSearchRequest {
  query: string;
  path?: string;
  maxDepth?: number;
  maxResults?: number;
  maxBytes?: number;
}

export interface OkfWikiNavigatorSearchResult {
  entries: OkfWikiNavigatorSearchEntry[];
  bounds: OkfWikiNavigatorBounds;
}

export interface OkfWikiNavigatorReadRequest {
  path: string;
  offsetBytes?: number;
  maxBytes?: number;
  startLine?: number;
  endLine?: number;
}

export interface OkfWikiNavigatorLinksRequest {
  path: string;
  includeBacklinks?: boolean;
  maxResults?: number;
}

export interface OkfWikiNavigatorLinksResult {
  path: string;
  links: OkfWikiNavigatorLinkEntry[];
  backlinks: OkfWikiNavigatorLinkEntry[];
  bounds: OkfWikiNavigatorBounds;
}

export interface OkfWikiNavigatorProvider {
  list(
    request?: OkfWikiNavigatorListRequest,
    signal?: AbortSignal,
  ): Promise<OkfWikiNavigatorListResult>;

  search(
    request: OkfWikiNavigatorSearchRequest,
    signal?: AbortSignal,
  ): Promise<OkfWikiNavigatorSearchResult>;

  read(
    request: OkfWikiNavigatorReadRequest,
    signal?: AbortSignal,
  ): Promise<OkfWikiNavigatorReadResult>;

  links(
    request: OkfWikiNavigatorLinksRequest,
    signal?: AbortSignal,
  ): Promise<OkfWikiNavigatorLinksResult>;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeTraceString(value: string): string {
  let text = value.replace(/\/mnt\/thinkwork-okf\/[^\s)"']+/g, "[okf-root]");
  text = text.replace(/s3:\/\/[^\s)"']+/g, "[s3-object]");
  if (text.length > MAX_TRACE_STRING_LENGTH) {
    text = `${text.slice(0, MAX_TRACE_STRING_LENGTH)}...`;
  }
  return text;
}

function sanitizeTraceValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeTraceString(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_TRACE_ITEMS).map(sanitizeTraceValue);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const normalized = key.toLowerCase();
      if (
        normalized.includes("root") ||
        normalized.includes("absolute") ||
        normalized.includes("s3key") ||
        normalized.includes("bucket")
      ) {
        continue;
      }
      output[key] = sanitizeTraceValue(child);
    }
    return output;
  }
  return undefined;
}

function sanitizedRecord(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeTraceValue(value);
  return recordValue(sanitized);
}

function traceFromDetails(
  details: Record<string, unknown>,
  fallback: OkfWikiTraceFallback = {},
): OkfWikiContextTrace | null {
  const raw = recordValue(details.okfWikiTrace ?? details.okf_wiki_trace);
  if (Object.keys(raw).length === 0) return null;

  const tool = stringValue(raw.tool) ?? stringValue(fallback.toolName);
  if (!tool || !OKF_WIKI_NAVIGATOR_TOOL_NAMES.includes(tool as never)) {
    return null;
  }

  const bounds = sanitizedRecord(raw.bounds);
  const redaction = recordValue(raw.redaction);
  const trace: OkfWikiContextTrace = {
    ...sanitizedRecord(raw),
    surface: "okf_efs",
    tool,
    ...(stringValue(fallback.toolCallId)
      ? { tool_call_id: stringValue(fallback.toolCallId) }
      : {}),
    redaction: {
      ...sanitizedRecord(redaction),
      source: "okf_navigator",
      policy: "cite_or_summarize_only",
    },
  };

  const entries = Array.isArray(raw.entries)
    ? raw.entries.slice(0, MAX_TRACE_ITEMS).map(sanitizeTraceValue)
    : undefined;
  const links = Array.isArray(raw.links)
    ? raw.links.slice(0, MAX_TRACE_ITEMS).map(sanitizeTraceValue)
    : undefined;
  const backlinks = Array.isArray(raw.backlinks)
    ? raw.backlinks.slice(0, MAX_TRACE_ITEMS).map(sanitizeTraceValue)
    : undefined;

  if (entries) trace.entries = entries;
  if (links) trace.links = links;
  if (backlinks) trace.backlinks = backlinks;
  if (Object.keys(bounds).length > 0) trace.bounds = bounds;

  const truncated =
    booleanValue(raw.truncated) ?? booleanValue(bounds.truncated) ?? false;
  if (truncated) trace.truncated = true;

  for (const key of [
    "query",
    "path",
    "entryCount",
    "matchCount",
    "linkCount",
    "backlinkCount",
    "offsetBytes",
    "bytesRead",
    "startLine",
    "endLine",
  ]) {
    const value = raw[key];
    const text = stringValue(value);
    const num = numberValue(value);
    if (text !== undefined) trace[key] = sanitizeTraceString(text);
    if (num !== undefined) trace[key] = num;
  }

  return trace;
}

export function okfWikiContextTraceFromToolResult(
  result: unknown,
  fallback: OkfWikiTraceFallback = {},
): OkfWikiContextTrace | null {
  const record = recordValue(result);
  const direct = traceFromDetails(record, fallback);
  if (direct) return direct;
  const details = recordValue(record.details);
  return traceFromDetails(details, fallback);
}

export function okfWikiContextTraceFromToolInvocation(
  invocation: Record<string, unknown>,
): OkfWikiContextTrace | null {
  const fallback = {
    toolCallId:
      stringValue(invocation.id) ??
      stringValue(invocation.tool_call_id) ??
      stringValue(invocation.toolCallId),
    toolName:
      stringValue(invocation.tool_name) ??
      stringValue(invocation.toolName) ??
      stringValue(invocation.name),
  };
  const direct = traceFromDetails(invocation, fallback);
  if (direct) return direct;

  const details = recordValue(invocation.details);
  const fromDetails = traceFromDetails(details, fallback);
  if (fromDetails) return fromDetails;

  return okfWikiContextTraceFromToolResult(invocation.result, fallback);
}

function okfWikiTraceAction(tool: string): string {
  switch (tool) {
    case "wiki_ls":
      return "list";
    case "wiki_rg":
      return "search";
    case "wiki_read":
      return "read";
    case "wiki_links":
      return "links";
    default:
      return tool.replace(/_/g, " ");
  }
}

export function okfWikiContextTraceMessage(trace: OkfWikiContextTrace): string {
  const action = okfWikiTraceAction(trace.tool);
  const count =
    numberValue(trace.matchCount) ??
    numberValue(trace.entryCount) ??
    numberValue(trace.linkCount) ??
    numberValue(trace.backlinkCount) ??
    (Array.isArray(trace.entries) ? trace.entries.length : undefined) ??
    (Array.isArray(trace.links) ? trace.links.length : undefined) ??
    (Array.isArray(trace.backlinks) ? trace.backlinks.length : undefined) ??
    0;
  const target = trace.query ?? trace.path;
  const targetText = target ? ` for "${target}"` : "";
  return `OKF wiki ${action} returned ${count} item${count === 1 ? "" : "s"}${targetText}`;
}
