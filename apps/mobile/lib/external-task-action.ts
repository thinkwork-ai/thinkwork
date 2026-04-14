/**
 * External-task action dispatcher.
 *
 * Builds the argument object for `ExecuteExternalTaskActionMutation` so the
 * GenUI layer can stay UI-only. The mutation is executed by the caller (a
 * React hook from urql) — this file just shapes the payload and normalizes
 * params so provider-neutral blocks never learn about `AWSJSON`.
 */

import type { TaskActionType } from '@/components/genui/external-task/types';

export type ExecuteExternalTaskActionInput = {
  threadId: string;
  actionType: TaskActionType;
  params: string;
};

export function buildExecuteExternalTaskActionVariables({
  threadId,
  actionType,
  params,
}: {
  threadId: string;
  actionType: TaskActionType;
  params: Record<string, unknown>;
}): ExecuteExternalTaskActionInput {
  return {
    threadId,
    actionType,
    params: JSON.stringify(params ?? {}),
  };
}
