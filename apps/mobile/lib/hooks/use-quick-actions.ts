import { useQuery, useMutation } from "urql";
import {
  UserQuickActionsQuery,
  CreateQuickActionMutation,
  UpdateQuickActionMutation,
  DeleteQuickActionMutation,
  ReorderQuickActionsMutation,
} from "@/lib/graphql-queries";

export interface QuickAction {
  id: string;
  userId: string;
  tenantId: string;
  title: string;
  prompt: string;
  workspaceAgentId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function useQuickActions(tenantId: string | undefined) {
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
