import {
  createThreadGenUISpecHash,
  type ThreadGenUIActionDescriptor,
  type ThreadGenUIData,
  type ThreadGenUIPrimitive,
} from "@thinkwork/genui";

export interface GenUIActionSource {
  threadId?: string | null;
  sourceMessageId?: string | null;
  partId?: string | null;
  data: ThreadGenUIData;
}

export interface HandleGenUIActionInput {
  threadId: string;
  sourceMessageId: string;
  partId: string;
  actionId: string;
  specHash: string;
  idempotencyKey: string;
  params: Record<string, ThreadGenUIPrimitive>;
}

export function canSubmitGenUIAction(source: GenUIActionSource): boolean {
  return Boolean(
    source.threadId &&
    source.sourceMessageId &&
    source.partId &&
    source.data.status === "ready" &&
    source.data.specHash,
  );
}

export function buildHandleGenUIActionInput(
  source: GenUIActionSource,
  action: ThreadGenUIActionDescriptor,
): HandleGenUIActionInput {
  if (!canSubmitGenUIAction(source)) {
    throw new Error("Generated UI action source is not ready.");
  }
  const params = normalizeActionParams(action.params);
  return {
    threadId: source.threadId!,
    sourceMessageId: source.sourceMessageId!,
    partId: source.partId!,
    actionId: action.id,
    specHash: source.data.specHash!,
    idempotencyKey: createGenUIActionIdempotencyKey(source, action),
    params,
  };
}

export function createGenUIActionIdempotencyKey(
  source: GenUIActionSource,
  action: ThreadGenUIActionDescriptor,
): string {
  const digest = createThreadGenUISpecHash({
    actionId: action.id,
    partId: source.partId,
    sourceMessageId: source.sourceMessageId,
    specHash: source.data.specHash,
    threadId: source.threadId,
  });
  return `genui-action:${digest}`;
}

function normalizeActionParams(
  value: ThreadGenUIActionDescriptor["params"],
): Record<string, ThreadGenUIPrimitive> {
  const normalized: Record<string, ThreadGenUIPrimitive> = {};
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
