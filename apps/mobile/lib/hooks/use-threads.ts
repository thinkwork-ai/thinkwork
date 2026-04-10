import { useQuery, useMutation } from "urql";
import type { ThreadsQueryVariables } from "@/lib/gql/graphql";
import { ThreadsQuery, ThreadQuery, CreateThreadMutation, UpdateThreadMutation, AddThreadCommentMutation } from "@/lib/graphql-queries";

export function useThreads(tenantId: string | undefined, opts?: Omit<ThreadsQueryVariables, "tenantId">) {
  return useQuery({ query: ThreadsQuery, variables: { tenantId: tenantId!, ...opts }, pause: !tenantId });
}
export function useThread(id: string | undefined) {
  return useQuery({ query: ThreadQuery, variables: { id: id! }, pause: !id });
}
export function useCreateThread() { return useMutation(CreateThreadMutation); }
export function useUpdateThread() { return useMutation(UpdateThreadMutation); }
export function useAddThreadComment() { return useMutation(AddThreadCommentMutation); }
