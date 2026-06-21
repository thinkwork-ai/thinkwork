import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { RoutineWorkflowRunRedirect } from "@/components/workflows/RoutineWorkflowRedirects";

export const Route = createFileRoute(
  "/_authed/settings/routines/$routineId_/executions/$executionId",
)({
  component: RoutineExecutionCompatibilityRoute,
});

function RoutineExecutionCompatibilityRoute() {
  const { routineId, executionId } = Route.useParams();
  return (
    <OperatorGuard>
      <RoutineWorkflowRunRedirect
        routineId={routineId}
        executionId={executionId}
      />
    </OperatorGuard>
  );
}
