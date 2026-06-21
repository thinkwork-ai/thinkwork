import { useCallback, useMemo, useState } from "react";
import { useMutation } from "urql";
import type {
  ThreadGenUIActionDescriptor,
  ThreadGenUIData,
} from "@thinkwork/genui";
import { HandleGenUIActionMutation } from "@/lib/graphql-queries";
import {
  buildHandleGenUIActionInput,
  createGenUIActionIdempotencyKey,
  type GenUIActionSource,
} from "./actions";

export type GenUIActionStatus =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "submitted" }
  | { state: "error"; message: string };

export function useGenUIAction(source: {
  threadId?: string | null;
  sourceMessageId?: string | null;
  partId?: string | null;
  data: ThreadGenUIData;
}) {
  const [, execute] = useMutation(HandleGenUIActionMutation);
  const [statuses, setStatuses] = useState<Record<string, GenUIActionStatus>>(
    {},
  );
  const actionSource = useMemo<GenUIActionSource>(
    () => ({
      threadId: source.threadId,
      sourceMessageId: source.sourceMessageId,
      partId: source.partId,
      data: source.data,
    }),
    [source.data, source.partId, source.sourceMessageId, source.threadId],
  );

  const submitAction = useCallback(
    async (action: ThreadGenUIActionDescriptor) => {
      const key = createGenUIActionIdempotencyKey(actionSource, action);
      setStatuses((current) => ({
        ...current,
        [key]: { state: "submitting" },
      }));
      try {
        const input = buildHandleGenUIActionInput(actionSource, action);
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
    (action: ThreadGenUIActionDescriptor): GenUIActionStatus => {
      const key = createGenUIActionIdempotencyKey(actionSource, action);
      return statuses[key] ?? { state: "idle" };
    },
    [actionSource, statuses],
  );

  return { submitAction, statusForAction };
}
