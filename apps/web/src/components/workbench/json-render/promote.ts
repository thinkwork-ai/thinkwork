import {
  createThreadJsonRenderSpecHash,
  type ThreadJsonRenderData,
} from "./validation";

export interface JsonRenderPromotionSource {
  threadId?: string | null;
  sourceMessageId?: string | null;
  partId?: string | null;
  data: ThreadJsonRenderData;
}

export interface PromoteJsonRenderArtifactInput {
  threadId: string;
  sourceMessageId: string;
  partId: string;
  specHash: string;
  idempotencyKey: string;
}

export function canPromoteJsonRender(
  source: JsonRenderPromotionSource,
): boolean {
  return Boolean(
    source.threadId &&
      source.sourceMessageId &&
      source.partId &&
      source.data.status === "ready" &&
      source.data.specHash,
  );
}

export function buildPromoteJsonRenderArtifactInput(
  source: JsonRenderPromotionSource,
): PromoteJsonRenderArtifactInput {
  if (!canPromoteJsonRender(source)) {
    throw new Error("Generated UI promotion source is not ready.");
  }
  return {
    threadId: source.threadId!,
    sourceMessageId: source.sourceMessageId!,
    partId: source.partId!,
    specHash: source.data.specHash!,
    idempotencyKey: createJsonRenderPromotionIdempotencyKey(source),
  };
}

export function createJsonRenderPromotionIdempotencyKey(
  source: JsonRenderPromotionSource,
): string {
  const digest = createThreadJsonRenderSpecHash({
    partId: source.partId,
    sourceMessageId: source.sourceMessageId,
    specHash: source.data.specHash,
    threadId: source.threadId,
  });
  return `json-render-promote:${digest}`;
}
