import { useCallback, useMemo, useState } from "react";
import { useMutation } from "urql";
import { HandleJsonRenderActionMutation } from "@/lib/graphql-queries";
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

export interface JsonRenderActionMessage {
  id?: string | null;
  metadata?: unknown;
}

export interface JsonRenderActionSuccess {
  action: ThreadJsonRenderDurableActionDescriptor;
  message: JsonRenderActionMessage | null;
}

export type JsonRenderActionSuccessHandler = (
  result: JsonRenderActionSuccess,
) => void;

export function useJsonRenderAction(source: {
  threadId?: string | null;
  sourceMessageId?: string | null;
  partId?: string | null;
  data: ThreadJsonRenderData;
  onActionSuccess?: JsonRenderActionSuccessHandler;
}) {
  const [, execute] = useMutation(HandleJsonRenderActionMutation);
  const { onActionSuccess } = source;
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
        const message =
          (
            result.data as
              | { handleJsonRenderAction?: JsonRenderActionMessage | null }
              | undefined
          )?.handleJsonRenderAction ?? null;
        setStatuses((current) => ({
          ...current,
          [key]: { state: "submitted" },
        }));
        onActionSuccess?.({ action, message });
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
    [actionSource, execute, onActionSuccess],
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
