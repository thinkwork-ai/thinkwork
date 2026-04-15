import { useQuery, useMutation } from "urql";
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
  return useQuery({
    query: UserQuickActionsQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
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
