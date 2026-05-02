import { useQuery, useMutation } from "urql";
import type {
  RoutinesQueryVariables,
  MobileRoutineExecutionsListQueryVariables,
} from "@/lib/gql/graphql";
import {
  RoutinesQuery,
  RoutineQuery,
  RoutineExecutionsListQuery,
  RoutineExecutionDetailQuery,
  CreateRoutineMutation,
  UpdateRoutineMutation,
  DeleteRoutineMutation,
  TriggerRoutineRunMutation,
} from "@/lib/graphql-queries";

export function useRoutines(
  tenantId: string | undefined,
  opts?: Omit<RoutinesQueryVariables, "tenantId">,
) {
  return useQuery({
    query: RoutinesQuery,
    variables: { tenantId: tenantId!, ...opts },
    pause: !tenantId,
  });
}
export function useRoutine(id: string | undefined) {
  return useQuery({ query: RoutineQuery, variables: { id: id! }, pause: !id });
}

// Phase D U13/U14 mobile parity: replaces useRoutineRuns. The legacy
// RoutineRunsQuery + RoutineRunDetailQuery were retired alongside the
// deprecated RoutineRun + RoutineStep GraphQL types.
export function useRoutineExecutions(
  routineId: string | undefined,
  opts?: Omit<MobileRoutineExecutionsListQueryVariables, "routineId">,
) {
  return useQuery({
    query: RoutineExecutionsListQuery,
    variables: { routineId: routineId!, ...opts },
    pause: !routineId,
  });
}
export function useRoutineExecution(id: string | undefined) {
  return useQuery({
    query: RoutineExecutionDetailQuery,
    variables: { id: id! },
    pause: !id,
  });
}
export function useCreateRoutine() {
  return useMutation(CreateRoutineMutation);
}
export function useUpdateRoutine() {
  return useMutation(UpdateRoutineMutation);
}
export function useDeleteRoutine() {
  return useMutation(DeleteRoutineMutation);
}
export function useTriggerRoutineRun() {
  return useMutation(TriggerRoutineRunMutation);
}
