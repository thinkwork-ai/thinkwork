import { useCallback, useMemo, useState } from "react";
import { useMutation } from "urql";
import { PromoteGenUIArtifactMutation } from "@/lib/graphql-queries";
import {
  buildPromoteJsonRenderArtifactInput,
  canPromoteJsonRender,
  createJsonRenderPromotionIdempotencyKey,
  type JsonRenderPromotionSource,
} from "./promote";
import type { ThreadJsonRenderData } from "./validation";

export type JsonRenderPromotionStatus =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "promoted"; artifactId: string; title: string }
  | { state: "error"; message: string };

export function usePromoteJsonRender(source: {
  threadId?: string | null;
  sourceMessageId?: string | null;
  partId?: string | null;
  data: ThreadJsonRenderData;
}) {
  const [, execute] = useMutation(PromoteGenUIArtifactMutation);
  const promotionSource = useMemo<JsonRenderPromotionSource>(
    () => ({
      threadId: source.threadId,
      sourceMessageId: source.sourceMessageId,
      partId: source.partId,
      data: source.data,
    }),
    [source.data, source.partId, source.sourceMessageId, source.threadId],
  );
  const key = useMemo(
    () => createJsonRenderPromotionIdempotencyKey(promotionSource),
    [promotionSource],
  );
  const [statuses, setStatuses] = useState<
    Record<string, JsonRenderPromotionStatus>
  >({});

  const promote = useCallback(async () => {
    setStatuses((current) => ({
      ...current,
      [key]: { state: "submitting" },
    }));
    try {
      const input = buildPromoteJsonRenderArtifactInput(promotionSource);
      const result = await execute({ input });
      if (result.error) throw result.error;
      const artifact = result.data?.promoteGenUIArtifact;
      if (!artifact?.id) {
        throw new Error("Generated UI promotion did not return an artifact.");
      }
      setStatuses((current) => ({
        ...current,
        [key]: {
          state: "promoted",
          artifactId: artifact.id,
          title: artifact.title || "Generated UI snapshot",
        },
      }));
    } catch (err) {
      setStatuses((current) => ({
        ...current,
        [key]: {
          state: "error",
          message:
            err instanceof Error
              ? err.message
              : "Generated UI promotion failed.",
        },
      }));
    }
  }, [execute, key, promotionSource]);

  return {
    canPromote: canPromoteJsonRender(promotionSource),
    promote,
    status: statuses[key] ?? { state: "idle" },
  };
}
