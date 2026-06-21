import {
  createThreadGenUISpecHash,
  type ThreadGenUIData,
} from "@thinkwork/genui";

export interface GenUIPromotionSource {
  threadId?: string | null;
  sourceMessageId?: string | null;
  partId?: string | null;
  data: ThreadGenUIData;
}

export interface PromoteGenUIArtifactInput {
  threadId: string;
  sourceMessageId: string;
  partId: string;
  specHash: string;
  idempotencyKey: string;
}

export function canPromoteGenUI(source: GenUIPromotionSource): boolean {
  return Boolean(
    source.threadId &&
      source.sourceMessageId &&
      source.partId &&
      source.data.status === "ready" &&
      source.data.specHash,
  );
}

export function buildPromoteGenUIArtifactInput(
  source: GenUIPromotionSource,
): PromoteGenUIArtifactInput {
  if (!canPromoteGenUI(source)) {
    throw new Error("Generated UI promotion source is not ready.");
  }
  return {
    threadId: source.threadId!,
    sourceMessageId: source.sourceMessageId!,
    partId: source.partId!,
    specHash: source.data.specHash!,
    idempotencyKey: createGenUIPromotionIdempotencyKey(source),
  };
}

export function createGenUIPromotionIdempotencyKey(
  source: GenUIPromotionSource,
): string {
  const digest = createThreadGenUISpecHash({
    partId: source.partId,
    sourceMessageId: source.sourceMessageId,
    specHash: source.data.specHash,
    threadId: source.threadId,
  });
  return `genui-promote:${digest}`;
}
