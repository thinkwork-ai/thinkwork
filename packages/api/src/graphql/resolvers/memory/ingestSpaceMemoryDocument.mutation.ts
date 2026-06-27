import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { buildSpaceDocumentRetainOptions } from "../../../lib/memory/hindsight-retain-params.js";
import { requireSpaceMemoryScope } from "./space-memory-scope.js";

const DOCUMENT_CONTEXT = "thinkwork_space_document";
const MAX_DOCUMENT_CONTENT_LENGTH = 256_000;
const MAX_DOCUMENT_ID_LENGTH = 512;
const MAX_PATH_LENGTH = 1024;

type IngestSpaceMemoryDocumentInput = {
  tenantId?: string | null;
  spaceId: string;
  documentId?: string | null;
  path?: string | null;
  title?: string | null;
  content: string;
  contentType?: string | null;
  sourceUrl?: string | null;
  timestamp?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | string | null;
  processAsync?: boolean | null;
};

export const ingestSpaceMemoryDocument = async (
  _parent: unknown,
  args: { input: IngestSpaceMemoryDocumentInput },
  ctx: GraphQLContext,
) => {
  const input = args.input;
  const content = (input.content || "").trim();
  if (!content) {
    throw new Error("Document content is required");
  }
  if (content.length > MAX_DOCUMENT_CONTENT_LENGTH) {
    throw new Error(
      `Document content exceeds ${MAX_DOCUMENT_CONTENT_LENGTH} characters`,
    );
  }

  const { tenantId, spaceId, requesterUserId } = await requireSpaceMemoryScope(
    ctx,
    input,
  );
  const suppliedPath = normalizePath(input.path);
  const documentId = spaceMemoryDocumentId(spaceId, {
    documentId: input.documentId,
    path: suppliedPath,
  });
  const path = suppliedPath ?? fallbackPathFromDocumentId(spaceId, documentId);
  const processAsync = input.processAsync ?? true;
  const ingestedAt = new Date().toISOString();

  const { adapter } = getMemoryServices();
  const capabilities = await adapter.capabilities();
  if (
    !capabilities.spaceMemory ||
    !capabilities.retain ||
    !adapter.upsertMarkdownMemoryDocument
  ) {
    throw new Error(
      "Active memory engine does not support Space document memory ingest",
    );
  }

  await adapter.upsertMarkdownMemoryDocument({
    tenantId,
    ownerType: "space",
    ownerId: spaceId,
    path,
    content,
    documentId,
    context: DOCUMENT_CONTEXT,
    async: processAsync,
    hindsight: buildSpaceDocumentRetainOptions({
      spaceId,
      timestamp: input.timestamp,
      tags: input.tags ?? [],
    }),
    metadata: {
      ...parseMetadata(input.metadata),
      source: "space_memory_document",
      sourceContext: DOCUMENT_CONTEXT,
      documentTitle: normalizeOptionalString(input.title),
      sourceUrl: normalizeOptionalString(input.sourceUrl),
      contentType: normalizeOptionalString(input.contentType),
      ingestedAt,
      ingestedByUserId: requesterUserId,
    },
  });

  return {
    documentId,
    spaceId,
    path,
    status: processAsync ? "queued" : "upserted",
    processAsync,
    context: DOCUMENT_CONTEXT,
    contentBytes: Buffer.byteLength(content, "utf8"),
  };
};

export function spaceMemoryDocumentId(
  spaceId: string,
  input: { documentId?: string | null; path?: string | null },
): string {
  const supplied = normalizeDocumentToken(input.documentId);
  const prefix = `space_document:${spaceId}:`;
  if (supplied) {
    return supplied.startsWith(prefix) ? supplied : `${prefix}${supplied}`;
  }
  const path = normalizeDocumentToken(input.path);
  if (path) return `${prefix}${path}`;
  throw new Error("Document id or path is required for Space document ingest");
}

function fallbackPathFromDocumentId(spaceId: string, documentId: string): string {
  const prefix = `space_document:${spaceId}:`;
  const token = documentId.startsWith(prefix)
    ? documentId.slice(prefix.length)
    : documentId;
  return `documents/${token}.md`;
}

function normalizePath(path: string | null | undefined): string | undefined {
  const normalized = normalizeOptionalString(path)
    ?.replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
  if (!normalized) return undefined;
  if (normalized.length > MAX_PATH_LENGTH) {
    throw new Error(`Document path exceeds ${MAX_PATH_LENGTH} characters`);
  }
  return normalized;
}

function normalizeDocumentToken(value: string | null | undefined): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return "";
  if (normalized.length > MAX_DOCUMENT_ID_LENGTH) {
    throw new Error(
      `Document id exceeds ${MAX_DOCUMENT_ID_LENGTH} characters`,
    );
  }
  return normalized.replace(/\s+/g, " ").replace(/[^\w:./=-]+/g, "-");
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseMetadata(
  raw: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  return {};
}
