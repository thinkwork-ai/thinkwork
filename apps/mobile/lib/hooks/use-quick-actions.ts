import { useCallback, useState } from "react";
import { useQuery, useMutation } from "urql";
import { useFocusEffect } from "expo-router";
import {
  UserQuickActionsQuery,
  CreateQuickActionMutation,
  UpdateQuickActionMutation,
  DeleteQuickActionMutation,
  ReorderQuickActionsMutation,
} from "@/lib/graphql-queries";

/** Which footer the action belongs to. Existing rows default to "thread". */
export type QuickActionScope = "thread" | "task";

export interface QuickAction {
  id: string;
  userId: string;
  tenantId: string;
  title: string;
  prompt: string;
  workspaceAgentId: string | null;
  scope: QuickActionScope;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Quick actions for the current user.
 *
 * The second `scope` argument is accepted for forward compatibility with
 * the backend PR that adds scope filtering server-side, but we do NOT
 * pass it as a GraphQL variable yet — the deployed graphql-http Lambda
 * doesn't know the `$scope` argument until that PR ships. Once it's
 * deployed, put the variable back and the UI will start rendering
 * separate Thread / Task lists.
 */
export function useQuickActions(
  tenantId: string | undefined,
  _scope: QuickActionScope = "thread",
) {
  // Pause when the caller's screen isn't focused. Both ThreadsScreen and
  // ThreadDetailRoute subscribe to this query — without this guard, a cache
  // update driven by one screen fans out to the other's still-mounted
  // subscription and React logs a "Cannot update component A while rendering
  // component B" warning. `useFocusEffect` toggles a local flag that urql
  // uses to pause the subscription when the screen is covered by another
  // stack entry.
  const [isFocused, setIsFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );
  return useQuery({
    query: UserQuickActionsQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !isFocused,
  });
}

export function useCreateQuickAction() {
  return useMutation(CreateQuickActionMutation);
}

export function useUpdateQuickAction() {
  return useMutation(UpdateQuickActionMutation);
}

export function useDeleteQuickAction() {
  return useMutation(DeleteQuickActionMutation);
}

export function useReorderQuickActions() {
  return useMutation(ReorderQuickActionsMutation);
}
