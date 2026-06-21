import { Navigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { SettingsRoutineDetail } from "@/components/settings/SettingsRoutineDetail";
import { SettingsRoutineExecutionDetail } from "@/components/settings/SettingsRoutineExecutionDetail";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsWorkflowRunsQuery,
  SettingsWorkflowsQuery,
} from "@/lib/graphql-queries";
import { jsonRecord, nestedString, type WorkflowBinding } from "./workflow-ui";

type WorkflowRow = {
  id: string;
  bindings: WorkflowBinding[];
};

type WorkflowRunRow = {
  id: string;
  workflowId: string;
  backendExecutionId?: string | null;
  backendExecutionRef?: unknown;
};

export function RoutineWorkflowDetailRedirect({
  routineId,
}: {
  routineId: string;
}) {
  const { tenantId } = useTenant();
  const [result] = useQuery<{ workflows: WorkflowRow[] }>({
    query: SettingsWorkflowsQuery,
    variables: { tenantId: tenantId ?? "", limit: 100 },
    pause: !tenantId,
  });

  if (result.fetching && !result.data) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  const workflow = result.data?.workflows.find((candidate) =>
    candidate.bindings.some(
      (binding) =>
        binding.bindingType === "step_functions_routine" &&
        binding.routineId === routineId,
    ),
  );

  if (workflow) {
    return (
      <Navigate
        to="/settings/workflows/$workflowId"
        params={{ workflowId: workflow.id }}
        replace
      />
    );
  }

  return <SettingsRoutineDetail />;
}

export function RoutineWorkflowRunRedirect({
  routineId,
  executionId,
}: {
  routineId: string;
  executionId: string;
}) {
  const { tenantId } = useTenant();
  const [result] = useQuery<{ workflowRuns: WorkflowRunRow[] }>({
    query: SettingsWorkflowRunsQuery,
    variables: { tenantId: tenantId ?? "", limit: 100 },
    pause: !tenantId,
  });

  if (result.fetching && !result.data) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  const run = result.data?.workflowRuns.find((candidate) => {
    const backendRef = jsonRecord(candidate.backendExecutionRef);
    return (
      nestedString(backendRef, "routineId") === routineId &&
      (nestedString(backendRef, "routineExecutionId") === executionId ||
        candidate.backendExecutionId === executionId)
    );
  });

  if (run) {
    return (
      <Navigate
        to="/settings/workflows/$workflowId/runs/$runId"
        params={{ workflowId: run.workflowId, runId: run.id }}
        replace
      />
    );
  }

  return <SettingsRoutineExecutionDetail />;
}
