import { useCallback, useMemo, useState } from "react";
import { useMutation } from "urql";
import { HandleGenUIActionMutation } from "@/lib/graphql-queries";
import {
  buildHandleJsonRenderActionInput,
  createJsonRenderActionIdempotencyKey,
  type JsonRenderActionSource,
} from "./actions";
import type {
  ThreadJsonRenderData,
  ThreadJsonRenderDurableActionDescriptor,
} from "./validation";

export type JsonRenderActionStatus =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "submitted" }
  | { state: "error"; message: string };

export function useJsonRenderAction(source: {
  threadId?: string | null;
  sourceMessageId?: string | null;
  partId?: string | null;
  data: ThreadJsonRenderData;
}) {
  const [, execute] = useMutation(HandleGenUIActionMutation);
  const [statuses, setStatuses] = useState<
    Record<string, JsonRenderActionStatus>
  >({});
  const actionSource = useMemo<JsonRenderActionSource>(
    () => ({
      threadId: source.threadId,
      sourceMessageId: source.sourceMessageId,
      partId: source.partId,
      data: source.data,
    }),
    [source.data, source.partId, source.sourceMessageId, source.threadId],
  );

  const submitAction = useCallback(
    async (action: ThreadJsonRenderDurableActionDescriptor) => {
      const key = createJsonRenderActionIdempotencyKey(actionSource, action);
      setStatuses((current) => ({
        ...current,
        [key]: { state: "submitting" },
      }));
      try {
        const input = buildHandleJsonRenderActionInput(actionSource, action);
        const result = await execute({ input });
        if (result.error) throw result.error;
        setStatuses((current) => ({
          ...current,
          [key]: { state: "submitted" },
        }));
      } catch (err) {
        setStatuses((current) => ({
          ...current,
          [key]: {
            state: "error",
            message:
              err instanceof Error
                ? err.message
                : "Generated UI action failed.",
          },
        }));
      }
    },
    [actionSource, execute],
  );

  const statusForAction = useCallback(
    (
      action: ThreadJsonRenderDurableActionDescriptor,
    ): JsonRenderActionStatus => {
      const key = createJsonRenderActionIdempotencyKey(actionSource, action);
      return statuses[key] ?? { state: "idle" };
    },
    [actionSource, statuses],
  );

  return { submitAction, statusForAction };
}
