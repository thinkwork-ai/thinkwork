import { useQuery, useMutation } from "urql";
import type { RoutinesQueryVariables, RoutineRunsQueryVariables } from "@/lib/gql/graphql";
import {
  RoutinesQuery, RoutineQuery, RoutineRunsQuery,
  CreateRoutineMutation, UpdateRoutineMutation, DeleteRoutineMutation, TriggerRoutineRunMutation,
} from "@/lib/graphql-queries";

export function useRoutines(tenantId: string | undefined, opts?: Omit<RoutinesQueryVariables, "tenantId">) {
  return useQuery({ query: RoutinesQuery, variables: { tenantId: tenantId!, ...opts }, pause: !tenantId });
}
export function useRoutine(id: string | undefined) {
  return useQuery({ query: RoutineQuery, variables: { id: id! }, pause: !id });
}
export function useRoutineRuns(routineId: string | undefined, opts?: Omit<RoutineRunsQueryVariables, "routineId">) {
  return useQuery({ query: RoutineRunsQuery, variables: { routineId: routineId!, ...opts }, pause: !routineId });
}
export function useCreateRoutine() { return useMutation(CreateRoutineMutation); }
export function useUpdateRoutine() { return useMutation(UpdateRoutineMutation); }
export function useDeleteRoutine() { return useMutation(DeleteRoutineMutation); }
export function useTriggerRoutineRun() { return useMutation(TriggerRoutineRunMutation); }
