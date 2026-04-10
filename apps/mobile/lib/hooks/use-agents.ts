import { useQuery, useMutation } from "urql";
import type { AgentsQueryVariables } from "@/lib/gql/graphql";
import {
  AgentsQuery, AgentQuery, CreateAgentMutation, UpdateAgentMutation,
  DeleteAgentMutation, UpdateAgentStatusMutation,
} from "@/lib/graphql-queries";

export function useAgents(tenantId: string | undefined, opts?: Omit<AgentsQueryVariables, "tenantId">) {
  return useQuery({
    query: AgentsQuery,
    variables: { tenantId: tenantId!, ...opts },
    pause: !tenantId,
  });
}

export function useAgent(id: string | undefined) {
  return useQuery({ query: AgentQuery, variables: { id: id! }, pause: !id });
}

export function useCreateAgent() { return useMutation(CreateAgentMutation); }
export function useUpdateAgent() { return useMutation(UpdateAgentMutation); }
export function useDeleteAgent() { return useMutation(DeleteAgentMutation); }
export function useUpdateAgentStatus() { return useMutation(UpdateAgentStatusMutation); }
