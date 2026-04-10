import { useQuery, useMutation } from "urql";
import {
  TeamsQuery, TeamQuery, CreateTeamMutation, UpdateTeamMutation, DeleteTeamMutation,
  AddTeamAgentMutation, RemoveTeamAgentMutation, AddTeamUserMutation, RemoveTeamUserMutation,
} from "@/lib/graphql-queries";

export function useTeams(tenantId: string | undefined) {
  return useQuery({ query: TeamsQuery, variables: { tenantId: tenantId! }, pause: !tenantId });
}
export function useTeam(id: string | undefined) {
  return useQuery({ query: TeamQuery, variables: { id: id! }, pause: !id });
}
export function useCreateTeam() { return useMutation(CreateTeamMutation); }
export function useUpdateTeam() { return useMutation(UpdateTeamMutation); }
export function useDeleteTeam() { return useMutation(DeleteTeamMutation); }
export function useAddTeamAgent() { return useMutation(AddTeamAgentMutation); }
export function useRemoveTeamAgent() { return useMutation(RemoveTeamAgentMutation); }
export function useAddTeamUser() { return useMutation(AddTeamUserMutation); }
export function useRemoveTeamUser() { return useMutation(RemoveTeamUserMutation); }
