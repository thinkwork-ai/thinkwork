import { GraphQLError } from "graphql";
import { ModelApprovalError } from "./model-approvals.js";

export const REQUESTED_MODEL_METADATA_KEY = "requestedModelId";

export function normalizeRequestedModelId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseJsonRecord(parsed);
    } catch {
      return {};
    }
  }
  if (typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function requestedModelIdFromMetadata(value: unknown): string | null {
  const metadata = parseJsonRecord(value);
  return normalizeRequestedModelId(metadata[REQUESTED_MODEL_METADATA_KEY]);
}

export function resolveRequestedModelId(input: {
  modelId?: unknown;
  metadata?: unknown;
}): string | null {
  return (
    normalizeRequestedModelId(input.modelId) ??
    requestedModelIdFromMetadata(input.metadata)
  );
}

export function withRequestedModelMetadata(
  metadata: Record<string, unknown> | undefined,
  modelId: string | null,
): Record<string, unknown> | undefined {
  if (!modelId) return metadata;
  return {
    ...(metadata ?? {}),
    [REQUESTED_MODEL_METADATA_KEY]: modelId,
  };
}

export function modelApprovalGraphQLError(error: ModelApprovalError) {
  return new GraphQLError(error.message, {
    extensions: { code: "BAD_USER_INPUT", modelApprovalCode: error.code },
  });
}
