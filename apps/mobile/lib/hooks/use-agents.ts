import { useQuery, useMutation } from "urql";
import type { AgentsQueryVariables } from "@/lib/gql/graphql";
import {
  AgentsQuery,
  AgentQuery,
  CreateAgentMutation,
  UpdateAgentMutation,
  DeleteAgentMutation,
  UpdateAgentStatusMutation,
} from "@/lib/graphql-queries";

export function useAgents(
  tenantId: string | undefined,
  opts?: Omit<AgentsQueryVariables, "tenantId">,
) {
  const [result, reexecute] = useQuery({
    query: AgentsQuery,
    variables: { tenantId: tenantId!, ...opts },
    pause: !tenantId,
  });
  const data =
    result.data && "agent" in result.data && !(result.data as any).agents
      ? {
          ...(result.data as any),
          agents: (result.data as any).agent ? [(result.data as any).agent] : [],
        }
      : result.data;
  return [{ ...result, data }, reexecute] as any;
}

export function useAgent(id: string | undefined) {
  return useQuery({ query: AgentQuery, variables: { id: id! }, pause: !id });
}

export function useCreateAgent() {
  return useMutation(CreateAgentMutation);
}
export function useUpdateAgent() {
  return useMutation(UpdateAgentMutation);
}
export function useDeleteAgent() {
  return useMutation(DeleteAgentMutation);
}
export function useUpdateAgentStatus() {
  return useMutation(UpdateAgentStatusMutation);
}
