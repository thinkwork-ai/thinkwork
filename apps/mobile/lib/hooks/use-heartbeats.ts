import { useQuery, useMutation } from "urql";
import {
  ThreadTurnsQuery, ThreadTurnDetailQuery, ThreadTurnEventsQuery,
  CancelThreadTurnMutation, CreateWakeupRequestMutation,
} from "@/lib/graphql-queries";

export function useHeartbeatRuns(tenantId: string | undefined, opts?: { agentId?: string; status?: string; limit?: number }) {
  return useQuery({ query: ThreadTurnsQuery, variables: { tenantId: tenantId!, ...opts }, pause: !tenantId });
}
export function useHeartbeatRunDetail(id: string | undefined) {
  return useQuery({ query: ThreadTurnDetailQuery, variables: { id: id! }, pause: !id });
}
export function useHeartbeatRunEvents(runId: string | undefined, opts?: { afterSeq?: number; limit?: number }) {
  return useQuery({ query: ThreadTurnEventsQuery, variables: { runId: runId!, ...opts }, pause: !runId });
}
export function useCancelHeartbeatRun() { return useMutation(CancelThreadTurnMutation); }
export function useCreateWakeupRequest() { return useMutation(CreateWakeupRequestMutation); }
