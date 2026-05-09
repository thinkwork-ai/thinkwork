import { useQuery, useMutation, useSubscription } from "urql";
import {
  InboxItemsQuery,
  InboxItemQuery,
  DecideInboxItemMutation,
  AddInboxItemCommentMutation,
  OnInboxItemStatusChangedSubscription,
} from "@/lib/graphql-queries";
import { visibleMobileInboxItems } from "@/lib/mobile-inbox";

export function useInboxItems(
  tenantId: string | undefined,
  opts?: { status?: string; entityType?: string; entityId?: string },
) {
  return useQuery({
    query: InboxItemsQuery,
    variables: { tenantId: tenantId!, ...opts },
    pause: !tenantId,
  });
}

export function useInboxItem(id: string | undefined) {
  return useQuery({ query: InboxItemQuery, variables: { id: id! }, pause: !id });
}

export function useDecideInboxItem() {
  return useMutation(DecideInboxItemMutation);
}

export function useAddInboxItemComment() {
  return useMutation(AddInboxItemCommentMutation);
}

export function useInboxCount(tenantId: string | undefined) {
  const [result] = useQuery({
    query: InboxItemsQuery,
    variables: { tenantId: tenantId!, status: "PENDING" as any },
    pause: !tenantId,
    requestPolicy: "cache-first",
  });
  return visibleMobileInboxItems(result.data?.inboxItems ?? []).length;
}

export function useInboxStatusSubscription(tenantId: string | undefined) {
  return useSubscription({
    query: OnInboxItemStatusChangedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
}
