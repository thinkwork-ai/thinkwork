import { createThreadJsonRenderSpecHash } from "./hash.js";
import type {
  ThreadJsonRenderData,
  ThreadJsonRenderDurableActionDescriptor,
  ThreadJsonRenderPrimitive,
} from "./spec.js";

export interface ThreadJsonRenderActionSource {
  threadId?: string | null;
  sourceMessageId?: string | null;
  partId?: string | null;
  data: ThreadJsonRenderData;
}

export interface HandleThreadJsonRenderActionInput {
  threadId: string;
  sourceMessageId: string;
  partId: string;
  actionId: string;
  specHash: string;
  idempotencyKey: string;
  params: Record<string, ThreadJsonRenderPrimitive>;
}

export function canSubmitThreadJsonRenderAction(
  source: ThreadJsonRenderActionSource,
): boolean {
  return Boolean(
    source.threadId &&
      source.sourceMessageId &&
      source.partId &&
      source.data.status === "ready" &&
      source.data.specHash,
  );
}

export function buildHandleThreadJsonRenderActionInput(
  source: ThreadJsonRenderActionSource,
  action: ThreadJsonRenderDurableActionDescriptor,
): HandleThreadJsonRenderActionInput {
  if (!canSubmitThreadJsonRenderAction(source)) {
    throw new Error("Generated UI action source is not ready.");
  }
  const params = normalizeThreadJsonRenderActionParams(action.params);
  return {
    threadId: source.threadId!,
    sourceMessageId: source.sourceMessageId!,
    partId: source.partId!,
    actionId: action.id,
    specHash: source.data.specHash!,
    idempotencyKey: createThreadJsonRenderActionIdempotencyKey(source, action),
    params,
  };
}

export function createThreadJsonRenderActionIdempotencyKey(
  source: ThreadJsonRenderActionSource,
  action: ThreadJsonRenderDurableActionDescriptor,
): string {
  const digest = createThreadJsonRenderSpecHash({
    actionId: action.id,
    partId: source.partId,
    sourceMessageId: source.sourceMessageId,
    specHash: source.data.specHash,
    threadId: source.threadId,
  });
  return `json-render-action:${digest}`;
}

export function normalizeThreadJsonRenderActionParams(
  value:
    | ThreadJsonRenderDurableActionDescriptor["params"]
    | Record<string, unknown>
    | null
    | undefined,
): Record<string, ThreadJsonRenderPrimitive> {
  const normalized: Record<string, ThreadJsonRenderPrimitive> = {};
  for (const [key, param] of Object.entries(value ?? {})) {
    if (
      param === null ||
      typeof param === "string" ||
      typeof param === "number" ||
      typeof param === "boolean"
    ) {
      normalized[key] = param;
    }
  }
  return normalized;
}
