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
 * Quick actions for the current user scoped to a given footer. Each scope
 * has its own list and its own sort order — reordering one doesn't touch
 * the other. Pass `scope="task"` from the Tasks footer, `scope="thread"`
 * (or omit) from the Threads footer.
 */
export function useQuickActions(
  tenantId: string | undefined,
  scope: QuickActionScope = "thread",
) {
  return useQuery({
    query: UserQuickActionsQuery,
    variables: { tenantId: tenantId!, scope },
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
