import type { McpRuntimeRecordLinkHints } from "./mcp.js";

export interface McpRecordLink {
  objectType: string;
  id: string;
  label: string;
  url: string;
}

export interface EnrichMcpRecordLinksInput {
  hints?: McpRuntimeRecordLinkHints;
  response: unknown;
  text: string;
  toolName: string;
  maxLinks?: number;
}

export interface EnrichMcpRecordLinksResult {
  text: string;
  recordLinks: McpRecordLink[];
}

const DEFAULT_MAX_RECORD_LINKS = 5;
const ROUTE_TEMPLATE_SEGMENT_RE = /^[A-Za-z0-9._~-]+$|^\{id\}$/;

export function enrichMcpRecordLinks(
  input: EnrichMcpRecordLinksInput,
): EnrichMcpRecordLinksResult {
  const maxLinks = input.maxLinks ?? DEFAULT_MAX_RECORD_LINKS;
  if (!input.hints || maxLinks <= 0) {
    return { text: input.text, recordLinks: [] };
  }
  if (!isSafeBrowserBaseUrl(input.hints.browserBaseUrl)) {
    return { text: input.text, recordLinks: [] };
  }

  const links: McpRecordLink[] = [];
  const seen = new Set<string>();
  for (const candidate of responseCandidates(input.response)) {
    if (links.length >= maxLinks) break;
    if (!isRecord(candidate)) continue;
    for (const route of input.hints.routes) {
      if (links.length >= maxLinks) break;
      if (!candidateMatchesRoute(candidate, route.objectType, input.toolName)) {
        continue;
      }
      const id = firstStringField(candidate, route.idFields ?? ["id"]);
      if (!id || !isSafeRecordId(id)) continue;
      const url = recordUrl(input.hints, route.routeTemplate, id, candidate);
      if (!url || input.text.includes(url)) continue;
      const key = `${route.objectType}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label =
        firstStringField(candidate, route.labelFields ?? ["name", "title"]) ||
        `${route.objectType} ${id}`;
      links.push({
        objectType: route.objectType,
        id,
        label,
        url,
      });
    }
  }

  if (links.length === 0) {
    return { text: input.text, recordLinks: [] };
  }

  const block = [
    "Record links:",
    ...links.map((link) => `- ${link.label}: ${link.url}`),
  ].join("\n");
  return {
    text: input.text.trim() ? `${input.text.trim()}\n\n${block}` : block,
    recordLinks: links,
  };
}

function* responseCandidates(response: unknown): Generator<unknown> {
  yield* jsonCandidates(response);
  const record = objectOrNull(response);
  if (!record) return;
  if ("structuredContent" in record) {
    yield* jsonCandidates(record.structuredContent);
  }
  const content = record.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      yield* contentItemCandidates(item);
    }
  }
}

function* contentItemCandidates(item: unknown): Generator<unknown> {
  const record = objectOrNull(item);
  if (!record) return;
  yield* jsonCandidates(record);
  for (const key of ["json", "data", "record", "records"]) {
    if (key in record) yield* jsonCandidates(record[key]);
  }
  if (typeof record.text === "string") {
    const parsed = parseJson(record.text);
    if (parsed !== undefined) yield* jsonCandidates(parsed);
  }
}

function* jsonCandidates(value: unknown): Generator<unknown> {
  if (Array.isArray(value)) {
    for (const item of value) yield* jsonCandidates(item);
    return;
  }
  const record = objectOrNull(value);
  if (!record) return;
  yield record;
  for (const [key, nested] of Object.entries(record)) {
    if (key === "arguments" || key === "params" || key === "input") continue;
    if (Array.isArray(nested)) {
      for (const item of nested) yield* jsonCandidates(item);
    } else if (objectOrNull(nested)) {
      yield* jsonCandidates(nested);
    }
  }
}

function candidateMatchesRoute(
  candidate: Record<string, unknown>,
  objectType: string,
  toolName: string,
): boolean {
  const explicitType = firstStringField(candidate, [
    "objectType",
    "object_type",
    "entityType",
    "entity_type",
    "type",
    "__typename",
  ]);
  if (explicitType) {
    return normalizeType(explicitType) === objectType;
  }
  const normalizedTool = normalizeType(toolName);
  return objectTypeAliases(objectType).some((alias) =>
    normalizedTool.includes(alias),
  );
}

function recordUrl(
  hints: McpRuntimeRecordLinkHints,
  routeTemplate: string,
  id: string,
  record: Record<string, unknown>,
): string | null {
  if (!isSafeRouteTemplate(routeTemplate)) return null;
  const base = hints.browserBaseUrl.replace(/\/+$/, "");
  const path = routeTemplate.replace("{id}", encodeURIComponent(id));
  const hashField = hints.workspace?.hashField;
  const hashValue = hashField ? firstStringField(record, [hashField]) : "";
  return `${base}${path}${hashValue ? `#${encodeURIComponent(hashValue)}` : ""}`;
}

function firstStringField(
  record: Record<string, unknown>,
  fields: string[],
): string {
  for (const field of fields) {
    const value = fieldValue(record, field);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function fieldValue(record: Record<string, unknown>, path: string): unknown {
  let current: unknown = record;
  for (const part of path.split(".")) {
    const currentRecord = objectOrNull(current);
    if (!currentRecord) return undefined;
    current = currentRecord[part];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(objectOrNull(value));
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeType(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function isSafeRecordId(value: string): boolean {
  return !/[/?#\s<>"'\\\u0000-\u001F\u007F]/.test(value);
}

function isSafeRouteTemplate(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (/[?#\\%\s<>\[\]()"']/.test(value)) return false;
  if (/[\u0000-\u001F\u007F]/.test(value)) return false;
  const placeholders = value.match(/\{[^}]*\}/g) ?? [];
  if (placeholders.length !== 1 || placeholders[0] !== "{id}") return false;
  const segments = value.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) return false;
  let idSegmentCount = 0;
  for (const segment of segments) {
    if (segment === "." || segment === "..") return false;
    if (!ROUTE_TEMPLATE_SEGMENT_RE.test(segment)) return false;
    if (segment === "{id}") idSegmentCount += 1;
  }
  return idSegmentCount === 1;
}

function isSafeBrowserBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.href === url.origin + "/" &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && isLocalBrowserOrigin(url)))
    );
  } catch {
    return false;
  }
}

function objectTypeAliases(objectType: string): string[] {
  return [
    objectType,
    `${objectType}s`,
    objectType.endsWith("y")
      ? `${objectType.slice(0, -1)}ies`
      : `${objectType}s`,
  ];
}

function isLocalBrowserOrigin(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.") ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}
