import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { RoutineDetailRouter } from "@/components/workflows/RoutineWorkflowRedirects";

export const Route = createFileRoute(
  "/_authed/settings/routines/$routineId_/executions/",
)({
  component: RoutineExecutionsTabRoute,
});

function RoutineExecutionsTabRoute() {
  const { routineId } = Route.useParams();
  return (
    <OperatorGuard>
      <RoutineDetailRouter routineId={routineId} tab="executions" />
    </OperatorGuard>
  );
}
