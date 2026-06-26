import {
  createThreadJsonRenderSpecHash,
  type ThreadJsonRenderData,
  type ThreadJsonRenderDurableActionDescriptor,
} from "./validation";

export type ThreadJsonRenderPrimitive = string | number | boolean | null;

export interface JsonRenderActionSource {
  threadId?: string | null;
  sourceMessageId?: string | null;
  partId?: string | null;
  data: ThreadJsonRenderData;
}

export interface HandleJsonRenderActionInput {
  threadId: string;
  sourceMessageId: string;
  partId: string;
  actionId: string;
  specHash: string;
  idempotencyKey: string;
  params: Record<string, ThreadJsonRenderPrimitive>;
}

export function canSubmitJsonRenderAction(
  source: JsonRenderActionSource,
): boolean {
  return Boolean(
    source.threadId &&
      source.sourceMessageId &&
      source.partId &&
      source.data.status === "ready" &&
      source.data.specHash,
  );
}

export function buildHandleJsonRenderActionInput(
  source: JsonRenderActionSource,
  action: ThreadJsonRenderDurableActionDescriptor,
): HandleJsonRenderActionInput {
  if (!canSubmitJsonRenderAction(source)) {
    throw new Error("Generated UI action source is not ready.");
  }
  const params = normalizeActionParams(action.params);
  return {
    threadId: source.threadId!,
    sourceMessageId: source.sourceMessageId!,
    partId: source.partId!,
    actionId: action.id,
    specHash: source.data.specHash!,
    idempotencyKey: createJsonRenderActionIdempotencyKey(source, action),
    params,
  };
}

export function createJsonRenderActionIdempotencyKey(
  source: JsonRenderActionSource,
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

function normalizeActionParams(
  value: ThreadJsonRenderDurableActionDescriptor["params"],
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
