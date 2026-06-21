import { useCallback, useMemo, useState } from "react";
import { useMutation } from "urql";
import type { ThreadGenUIData } from "@thinkwork/genui";
import { PromoteGenUIArtifactMutation } from "@/lib/graphql-queries";
import {
  buildPromoteGenUIArtifactInput,
  canPromoteGenUI,
  createGenUIPromotionIdempotencyKey,
  type GenUIPromotionSource,
} from "./promote";

export type GenUIPromotionStatus =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "promoted"; artifactId: string; title: string }
  | { state: "error"; message: string };

export function usePromoteGenUI(source: {
  threadId?: string | null;
  sourceMessageId?: string | null;
  partId?: string | null;
  data: ThreadGenUIData;
}) {
  const [, execute] = useMutation(PromoteGenUIArtifactMutation);
  const promotionSource = useMemo<GenUIPromotionSource>(
    () => ({
      threadId: source.threadId,
      sourceMessageId: source.sourceMessageId,
      partId: source.partId,
      data: source.data,
    }),
    [source.data, source.partId, source.sourceMessageId, source.threadId],
  );
  const key = useMemo(
    () => createGenUIPromotionIdempotencyKey(promotionSource),
    [promotionSource],
  );
  const [statuses, setStatuses] = useState<Record<string, GenUIPromotionStatus>>(
    {},
  );

  const promote = useCallback(async () => {
    setStatuses((current) => ({
      ...current,
      [key]: { state: "submitting" },
    }));
    try {
      const input = buildPromoteGenUIArtifactInput(promotionSource);
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
    canPromote: canPromoteGenUI(promotionSource),
    promote,
    status: statuses[key] ?? { state: "idle" },
  };
}
