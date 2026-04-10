import { useSubscription } from "urql";
import {
  OnAgentStatusChangedSubscription, OnNewMessageSubscription,
  OnHeartbeatActivitySubscription, OnThreadUpdatedSubscription,
  OnThreadTurnUpdatedSubscription,
} from "@/lib/graphql-queries";

export function useAgentStatusSubscription(tenantId: string | undefined) {
  return useSubscription({ query: OnAgentStatusChangedSubscription, variables: { tenantId: tenantId! }, pause: !tenantId });
}
export function useNewMessageSubscription(threadId: string | undefined) {
  return useSubscription({ query: OnNewMessageSubscription, variables: { threadId: threadId! }, pause: !threadId });
}
export function useHeartbeatActivitySubscription(tenantId: string | undefined) {
  return useSubscription({ query: OnHeartbeatActivitySubscription, variables: { tenantId: tenantId! }, pause: !tenantId });
}
export function useThreadUpdatedSubscription(tenantId: string | undefined) {
  return useSubscription({ query: OnThreadUpdatedSubscription, variables: { tenantId: tenantId! }, pause: !tenantId });
}
export function useThreadTurnUpdatedSubscription(tenantId: string | undefined) {
  return useSubscription({ query: OnThreadTurnUpdatedSubscription, variables: { tenantId: tenantId! }, pause: !tenantId });
}
