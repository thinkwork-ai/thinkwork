import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { buildSpaceMemoryRetainOptions } from "../../../lib/memory/hindsight-retain-params.js";
import { requireSpaceMemoryScope } from "./space-memory-scope.js";

const MAX_CONTENT_LENGTH = 4000;
const CAPTURE_SOURCE = "space_memory_capture";

export const captureSpaceMemory = async (
  _parent: unknown,
  args: {
    tenantId?: string | null;
    spaceId: string;
    content: string;
    metadata?: Record<string, unknown> | string | null;
    clientCaptureId?: string | null;
  },
  ctx: GraphQLContext,
) => {
  const trimmed = (args.content || "").trim();
  if (!trimmed) {
    throw new Error("Capture content is required");
  }
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Capture content exceeds ${MAX_CONTENT_LENGTH} characters`);
  }

  const { tenantId, spaceId, requesterUserId } = await requireSpaceMemoryScope(
    ctx,
    args,
  );

  const capturedAt = new Date().toISOString();
  const metadata: Record<string, unknown> = {
    ...parseMetadata(args.metadata),
    capture_source: CAPTURE_SOURCE,
    captured_at: capturedAt,
    captured_by_user_id: requesterUserId,
  };
  if (args.clientCaptureId) {
    metadata.client_capture_id = args.clientCaptureId;
  }

  const { adapter } = getMemoryServices();
  const capabilities = await adapter.capabilities();
  if (!capabilities.spaceMemory || !capabilities.retain) {
    throw new Error(
      "Active memory engine does not support Space memory capture",
    );
  }

  const result = await adapter.retain({
    tenantId,
    ownerType: "space",
    ownerId: spaceId,
    sourceType: "explicit_remember",
    content: trimmed,
    role: "user",
    hindsight: buildSpaceMemoryRetainOptions({ spaceId, capturedAt }),
    metadata,
  });

  return {
    memoryRecordId: result.record.id,
    content: { text: result.record.content.text },
    createdAt: result.record.createdAt,
    updatedAt: result.record.updatedAt ?? null,
    namespace:
      (result.record.metadata?.namespace as string | undefined) ??
      `space_${spaceId}`,
    strategyId: result.record.strategy ?? null,
    strategy: result.record.strategy ?? "semantic",
    score: 1,
    threadId: result.record.threadId ?? null,
    wikiPages: [],
  };
};

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
