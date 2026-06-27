import type {
  HindsightObservationScopes,
  HindsightRetainOptions,
  RetainConversationRequest,
} from "./types.js";

type RetainParamInput = {
  timestamp?: string | null;
  tags?: unknown[];
  documentTags?: unknown[];
  observationScopes?: HindsightObservationScopes | null;
};

export function buildThreadRetainOptions(
  messages: RetainConversationRequest["messages"],
): HindsightRetainOptions {
  return retainOptions({
    timestamp: latestIsoTimestamp(messages.map((message) => message.timestamp)),
    tags: ["source:thread", "surface:pi", "scope:personal", "scope:thread"],
    documentTags: ["source:thread", "scope:thread"],
    observationScopes: [["source:thread"], ["scope:thread"]],
  });
}

export function buildDailyMemoryRetainOptions(
  date: string,
): HindsightRetainOptions {
  return retainOptions({
    timestamp: dateToUtcTimestamp(date),
    tags: ["source:daily", "surface:pi", "scope:personal"],
    documentTags: ["source:daily", "scope:personal"],
    observationScopes: [["source:daily"], ["scope:personal"]],
  });
}

export function buildMobileCaptureRetainOptions(
  capturedAt: string,
): HindsightRetainOptions {
  return retainOptions({
    timestamp: capturedAt,
    tags: [
      "source:mobile-capture",
      "surface:mobile",
      "surface:graphql",
      "scope:personal",
      "scope:explicit-memory",
    ],
    documentTags: ["source:mobile-capture", "scope:explicit-memory"],
    observationScopes: [
      ["source:mobile-capture"],
      ["scope:explicit-memory"],
    ],
  });
}

export function buildSpaceMemoryRetainOptions(input: {
  spaceId: string;
  capturedAt: string;
}): HindsightRetainOptions {
  const spaceTag = `space:${input.spaceId}`;
  return retainOptions({
    timestamp: input.capturedAt,
    tags: [
      spaceTag,
      "source:space-memory",
      "surface:web",
      "surface:graphql",
      "scope:space",
      "scope:explicit-memory",
    ],
    documentTags: [spaceTag, "source:space-memory", "scope:space"],
    observationScopes: [[spaceTag], ["source:space-memory"], ["scope:space"]],
  });
}

export function buildSpaceDocumentRetainOptions(input: {
  spaceId: string;
  timestamp?: string | null;
  tags?: unknown[];
}): HindsightRetainOptions {
  const spaceTag = `space:${input.spaceId}`;
  const callerTags = normalizeHindsightTags(input.tags);
  return retainOptions({
    timestamp: toIsoTimestamp(input.timestamp) ?? "unset",
    tags: [
      spaceTag,
      "source:space-document",
      "surface:web",
      "surface:graphql",
      "scope:space",
      "scope:document",
      ...callerTags,
    ],
    documentTags: [
      spaceTag,
      "source:space-document",
      "scope:space",
      "scope:document",
      ...callerTags,
    ],
    observationScopes: [
      [spaceTag],
      ["source:space-document"],
      ["scope:space"],
      ["scope:document"],
    ],
  });
}

export function buildMcpUserMemoryRetainOptions(input: {
  capturedAt: string;
  callerTags?: unknown;
}): HindsightRetainOptions {
  return retainOptions({
    timestamp: input.capturedAt,
    tags: [
      "source:mcp-user-memory",
      "surface:mcp",
      "scope:personal",
      "scope:explicit-memory",
      ...normalizeHindsightTags(input.callerTags),
    ],
    documentTags: ["source:mcp-user-memory", "scope:explicit-memory"],
    observationScopes: [
      ["source:mcp-user-memory"],
      ["scope:explicit-memory"],
    ],
  });
}

export function buildRequesterMemoryRetainOptions(input: {
  path: string;
}): HindsightRetainOptions {
  return retainOptions({
    timestamp: requesterMemoryTimestamp(input.path) ?? "unset",
    tags: [
      "source:requester-memory",
      "surface:requester",
      "scope:personal",
      "scope:requester",
    ],
    documentTags: ["source:requester-memory", "scope:requester"],
    observationScopes: [["source:requester-memory"], ["scope:requester"]],
  });
}

export function buildRequesterThreadDigestRetainOptions(): HindsightRetainOptions {
  return retainOptions({
    timestamp: "unset",
    tags: [
      "source:requester-thread-digest",
      "surface:requester",
      "scope:personal",
      "scope:requester",
      "scope:thread",
    ],
    documentTags: ["source:requester-thread-digest", "scope:requester"],
    observationScopes: [
      ["source:requester-thread-digest"],
      ["scope:requester"],
    ],
  });
}

export function buildJournalImportRetainOptions(input: {
  timestamp?: unknown;
}): HindsightRetainOptions {
  return retainOptions({
    timestamp: toIsoTimestamp(input.timestamp),
    tags: ["source:journal-import", "surface:import", "scope:imported-history"],
    documentTags: ["source:journal-import", "scope:imported-history"],
    observationScopes: [
      ["source:journal-import"],
      ["scope:imported-history"],
    ],
  });
}

export function retainOptions(input: RetainParamInput): HindsightRetainOptions {
  const tags = normalizeHindsightTags(input.tags);
  const documentTags = normalizeHindsightTags(input.documentTags);
  return {
    ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(documentTags.length > 0 ? { documentTags } : {}),
    ...(input.observationScopes !== undefined
      ? { observationScopes: input.observationScopes }
      : {}),
  };
}

export function normalizeHindsightTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function latestIsoTimestamp(values: unknown[]): string | undefined {
  let latest: string | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const iso = toIsoTimestamp(value);
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms) || ms < latestMs) continue;
    latest = iso;
    latestMs = ms;
  }
  return latest;
}

function dateToUtcTimestamp(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return `${date}T00:00:00.000Z`;
}

function requesterMemoryTimestamp(path: string): string | undefined {
  const match = path.match(/^memory\/working\/(\d{4}-\d{2}-\d{2})\.md$/);
  return match ? dateToUtcTimestamp(match[1]) : undefined;
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed === "unset") return "unset";
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
